using System.Text.Json;

namespace CameraDrawButtons;

/// <summary>
/// Keeps USBPcap captures running for exactly the devices that connected clients watch. Rescans
/// the USB tree regularly, because the USB address changes whenever a device is plugged in again.
/// </summary>
internal sealed class ButtonMonitor
{
    private static readonly TimeSpan RescanInterval = TimeSpan.FromSeconds(2);

    private readonly object _lock = new();
    private readonly Dictionary<object, IReadOnlySet<UsbId>> _watchers = [];
    private readonly Dictionary<string, UsbPcapCapture> _captures = [];
    private readonly HashSet<UsbPcapCapture> _failed = [];
    private Dictionary<UsbLocation, UsbId> _locations = [];
    private StatusMessage _status = new("idle", null, []);
    private string _statusJson = "";
    private readonly SemaphoreSlim _wake = new(0);

    /// <summary>Raised on the monitor thread.</summary>
    public event Action<StatusMessage>? StatusChanged;
    /// <summary>Raised on a capture thread.</summary>
    public event Action<UsbId, bool>? Button;

    public StatusMessage Status
    {
        get { lock (_lock) return _status; }
    }

    public void SetWatch(object watcher, IReadOnlySet<UsbId> ids)
    {
        lock (_lock) _watchers[watcher] = ids;
        _wake.Release();
    }

    public void RemoveWatcher(object watcher)
    {
        lock (_lock) _watchers.Remove(watcher);
        _wake.Release();
    }

    public async Task RunAsync(CancellationToken cancel)
    {
        try
        {
            while (!cancel.IsCancellationRequested)
            {
                try
                {
                    Rescan();
                }
                catch (Exception ex)
                {
                    StopAll();
                    Publish(new StatusMessage("error", ex.Message, []));
                }
                try
                {
                    await _wake.WaitAsync(RescanInterval, cancel);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
        finally
        {
            StopAll();
        }
    }

    private void Rescan()
    {
        HashSet<UsbId> watched;
        lock (_lock) watched = [.. _watchers.Values.SelectMany(ids => ids)];
        if (watched.Count == 0)
        {
            StopAll();
            Publish(new StatusMessage("idle", null, []));
            return;
        }

        var filters = UsbTopology.Filters();
        if (filters.Count == 0)
        {
            StopAll();
            var installed = UsbTopology.UsbPcapInstalled();
            Publish(new StatusMessage(installed ? "usbpcap-reboot" : "usbpcap-missing", null, Devices(watched, [], [])));
            return;
        }

        var found = UsbTopology.Find(watched, filters);
        var wanted = new Dictionary<string, HashSet<int>>();
        var locations = new Dictionary<UsbLocation, UsbId>();
        foreach (var (id, list) in found)
        {
            foreach (var location in list)
            {
                locations[location] = id;
                if (!wanted.TryGetValue(location.Filter, out var addresses)) wanted[location.Filter] = addresses = [];
                addresses.Add(location.Address);
            }
        }

        // Stop captures that are no longer needed, watch other addresses or have failed.
        foreach (var (filter, capture) in _captures.ToList())
        {
            bool failed;
            lock (_lock) failed = _failed.Remove(capture);
            if (!failed && wanted.TryGetValue(filter, out var addresses) && addresses.SetEquals(capture.Addresses)) continue;
            _captures.Remove(filter);
            capture.Dispose();
        }

        lock (_lock) _locations = locations;

        string? busy = null, error = null;
        foreach (var (filter, addresses) in wanted)
        {
            if (_captures.ContainsKey(filter)) continue;
            try
            {
                _captures[filter] = new UsbPcapCapture(filter, addresses, (address, pressed) => OnButton(filter, address, pressed), OnFailed);
            }
            catch (Win32ErrorException ex) when (ex.Code is Native.ERROR_ACCESS_DENIED or Native.ERROR_SHARING_VIOLATION)
            {
                // As a service (SYSTEM) access is always allowed, so "denied" means another capture runs.
                if (Environment.IsPrivilegedProcess) busy = filter;
                else error = "USBPcap braucht Admin-Rechte.";
            }
            catch (Exception ex)
            {
                error = ex.Message;
            }
        }

        var devices = Devices(watched, found, _captures.Keys.ToHashSet());
        var state = busy != null ? "usbpcap-busy"
            : error != null ? "error"
            : devices.All(d => d.Connected) ? "ready"
            : "device-missing";
        Publish(new StatusMessage(state, busy != null ? $"{busy} wird von einem anderen Programm aufgezeichnet." : error, devices));
    }

    private static List<DeviceStatus> Devices(IEnumerable<UsbId> watched, Dictionary<UsbId, List<UsbLocation>> found, HashSet<string> capturing) =>
        [.. watched.OrderBy(id => id.ToString()).Select(id =>
        {
            var reference = DeviceRef.From(id);
            var locations = found.GetValueOrDefault(id) ?? [];
            return new DeviceStatus(reference.VendorId, reference.ProductId, locations.Count > 0,
                locations.Count > 0 && locations.All(l => capturing.Contains(l.Filter)));
        })];

    private void OnButton(string filter, int address, bool pressed)
    {
        UsbId id;
        lock (_lock)
        {
            if (!_locations.TryGetValue(new UsbLocation(filter, address), out id)) return;
        }
        Button?.Invoke(id, pressed);
    }

    private void OnFailed(UsbPcapCapture capture, Exception error)
    {
        Log.Write($"{capture.Filter}: {error.Message}");
        lock (_lock) _failed.Add(capture);
        _wake.Release();
    }

    private void StopAll()
    {
        foreach (var capture in _captures.Values) capture.Dispose();
        _captures.Clear();
        lock (_lock)
        {
            _failed.Clear();
            _locations = [];
        }
    }

    private void Publish(StatusMessage status)
    {
        var json = JsonSerializer.Serialize(status, ProtocolJson.Default.StatusMessage);
        lock (_lock)
        {
            if (json == _statusJson) return;
            _status = status;
            _statusJson = json;
        }
        StatusChanged?.Invoke(status);
    }
}
