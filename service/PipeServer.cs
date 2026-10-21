using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace CameraDrawButtons;

/// <summary>
/// Named pipe <c>\\.\pipe\cameradraw-buttons</c>: signed-in users may connect, tell the service
/// which devices to watch and receive status and button events.
/// </summary>
internal sealed class PipeServer(ButtonMonitor monitor)
{
    public const string PipeName = "cameradraw-buttons";
    private const int MaxClients = 8;
    private const int MaxLineLength = 4096;
    private const int MaxWatchedDevices = 16;

    private readonly object _lock = new();
    private readonly List<Client> _clients = [];

    public async Task RunAsync(CancellationToken cancel)
    {
        monitor.StatusChanged += status => Broadcast(Serialize(status), _ => true);
        monitor.Button += (id, pressed) =>
        {
            var reference = DeviceRef.From(id);
            var json = JsonSerializer.Serialize(new ButtonMessage(reference.VendorId, reference.ProductId, pressed), ProtocolJson.Default.ButtonMessage);
            Broadcast(json, client => client.Watching(id));
        };

        var first = true;
        while (!cancel.IsCancellationRequested)
        {
            NamedPipeServerStream pipe;
            try
            {
                // FirstPipeInstance: fail instead of joining a pipe someone else created under our name.
                pipe = NamedPipeServerStreamAcl.Create(PipeName, PipeDirection.InOut, MaxClients, PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous | (first ? PipeOptions.FirstPipeInstance : PipeOptions.None), 0, 0, Security());
            }
            catch (IOException) when (!first)
            {
                // All instances in use – wait for a client to leave.
                await Task.Delay(1000, cancel).ConfigureAwait(false);
                continue;
            }
            first = false;
            try
            {
                await pipe.WaitForConnectionAsync(cancel).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                await pipe.DisposeAsync().ConfigureAwait(false);
                break;
            }
            _ = ServeAsync(pipe, cancel);
        }
    }

    private static PipeSecurity Security()
    {
        var security = new PipeSecurity();
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        // Read and write only – no CreateNewInstance, so nobody else can serve clients under this name.
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.AuthenticatedUserSid, null), PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize, AccessControlType.Allow));
        return security;
    }

    private async Task ServeAsync(NamedPipeServerStream pipe, CancellationToken cancel)
    {
        var client = new Client(pipe);
        lock (_lock) _clients.Add(client);
        var writer = client.WriteLoopAsync(cancel);
        try
        {
            client.Send(Serialize(monitor.Status));
            var buffer = new byte[1024];
            var line = new MemoryStream();
            int read;
            while ((read = await pipe.ReadAsync(buffer, cancel).ConfigureAwait(false)) > 0)
            {
                for (var i = 0; i < read; i++)
                {
                    if (buffer[i] != (byte)'\n')
                    {
                        line.WriteByte(buffer[i]);
                        if (line.Length > MaxLineLength) return;
                        continue;
                    }
                    Handle(client, line.ToArray());
                    line.SetLength(0);
                }
            }
        }
        catch (Exception ex) when (ex is IOException or OperationCanceledException or ObjectDisposedException)
        {
            // Client went away.
        }
        finally
        {
            lock (_lock) _clients.Remove(client);
            monitor.RemoveWatcher(client);
            client.Close();
            await writer.ConfigureAwait(false);
            await pipe.DisposeAsync().ConfigureAwait(false);
        }
    }

    private void Handle(Client client, byte[] line)
    {
        ClientMessage? message;
        try
        {
            message = JsonSerializer.Deserialize(line, ProtocolJson.Default.ClientMessage);
        }
        catch (JsonException)
        {
            return;
        }
        if (message?.Watch == null) return;

        var ids = new HashSet<UsbId>();
        foreach (var device in message.Watch.Take(MaxWatchedDevices))
        {
            if (device != null && device.TryGetId(out var id)) ids.Add(id);
        }
        client.Watch = ids;
        monitor.SetWatch(client, ids);
    }

    private void Broadcast(string json, Func<Client, bool> include)
    {
        lock (_lock)
        {
            foreach (var client in _clients.Where(include)) client.Send(json);
        }
    }

    private static string Serialize(StatusMessage status) => JsonSerializer.Serialize(status, ProtocolJson.Default.StatusMessage);

    private sealed class Client(NamedPipeServerStream pipe)
    {
        // One writer per client keeps the messages in order.
        private readonly Channel<string> _outgoing = Channel.CreateBounded<string>(
            new BoundedChannelOptions(64) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true });

        public volatile IReadOnlySet<UsbId> Watch = new HashSet<UsbId>();

        public bool Watching(UsbId id) => Watch.Contains(id);

        public void Send(string json) => _outgoing.Writer.TryWrite(json);

        public void Close() => _outgoing.Writer.TryComplete();

        public async Task WriteLoopAsync(CancellationToken cancel)
        {
            try
            {
                await foreach (var json in _outgoing.Reader.ReadAllAsync(cancel).ConfigureAwait(false))
                {
                    var bytes = Encoding.UTF8.GetBytes(json + "\n");
                    await pipe.WriteAsync(bytes, cancel).ConfigureAwait(false);
                    await pipe.FlushAsync(cancel).ConfigureAwait(false);
                }
            }
            catch (Exception ex) when (ex is IOException or OperationCanceledException or ObjectDisposedException)
            {
                // Client went away.
            }
        }
    }
}
