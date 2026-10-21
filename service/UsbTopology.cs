using System.Buffers.Binary;
using Microsoft.Win32.SafeHandles;

namespace CameraDrawButtons;

/// <summary>A USB device type, e.g. 1b3f:2002.</summary>
internal readonly record struct UsbId(ushort VendorId, ushort ProductId)
{
    public override string ToString() => $"{VendorId:x4}:{ProductId:x4}";
}

/// <summary>Where a connected device can be captured: USBPcap control device + USB address.</summary>
internal readonly record struct UsbLocation(string Filter, int Address);

/// <summary>
/// Finds devices by VID/PID: every USBPcap control device (\\.\USBPcapN) sits on one root hub;
/// walking that hub tree yields the current USB address of each connected device.
/// </summary>
internal static unsafe class UsbTopology
{
    // CTL_CODE(FILE_DEVICE_USB = 0x22, function, METHOD_BUFFERED, FILE_ANY_ACCESS)
    private const uint IOCTL_USB_GET_NODE_INFORMATION = 0x220408;
    private const uint IOCTL_USB_GET_NODE_CONNECTION_NAME = 0x220414;
    private const uint IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX = 0x220448;
    // CTL_CODE(FILE_DEVICE_UNKNOWN, 0x803, METHOD_BUFFERED, FILE_ANY_ACCESS)
    private const uint IOCTL_USBPCAP_GET_HUB_SYMLINK = 0x22200C;

    /// <summary>USBPcap creates one control device per root hub, numbered from 1.</summary>
    private const int MaxFilters = 32;

    /// <summary>Paths of all USBPcap control devices, e.g. <c>\\.\USBPcap3</c>.</summary>
    public static List<string> Filters()
    {
        var filters = new List<string>();
        for (var i = 1; i <= MaxFilters; i++)
        {
            var path = $@"\\.\USBPcap{i}";
            // Access 0 is enough to ask for the hub; capturing needs a separate read handle.
            using var handle = Native.CreateFile(path, 0, 0, 0, Native.OPEN_EXISTING, 0, 0);
            if (!handle.IsInvalid) filters.Add(path);
        }
        return filters;
    }

    /// <summary>Finds the given device types on all root hubs that USBPcap is attached to.</summary>
    public static Dictionary<UsbId, List<UsbLocation>> Find(IReadOnlySet<UsbId> ids, IEnumerable<string> filters)
    {
        var found = new Dictionary<UsbId, List<UsbLocation>>();
        foreach (var (id, location) in Devices(filters))
        {
            if (!ids.Contains(id)) continue;
            if (!found.TryGetValue(id, out var list)) found[id] = list = [];
            list.Add(location);
        }
        return found;
    }

    /// <summary>All connected devices (no hubs) on the root hubs of the given USBPcap filters.</summary>
    public static List<(UsbId Id, UsbLocation Location)> Devices(IEnumerable<string> filters)
    {
        var devices = new List<(UsbId, UsbLocation)>();
        foreach (var filter in filters)
        {
            var hub = HubSymlink(filter);
            if (hub != null) WalkHub(hub, (address, id) => devices.Add((id, new UsbLocation(filter, address))), depth: 0);
        }
        return devices;
    }

    private static string? HubSymlink(string filter)
    {
        using var handle = Native.CreateFile(filter, 0, 0, 0, Native.OPEN_EXISTING, 0, 0);
        if (handle.IsInvalid) return null;
        var buffer = stackalloc char[1024];
        if (!Native.DeviceIoControl(handle, IOCTL_USBPCAP_GET_HUB_SYMLINK, null, 0, buffer, 1024 * sizeof(char), out var bytes, null))
            return null;
        return ToDevicePath(new string(buffer, 0, bytes / sizeof(char)).TrimEnd('\0'));
    }

    /// <summary><c>\??\USB#ROOT_HUB30#…</c> or <c>USB#…</c> → <c>\\.\USB#…</c></summary>
    private static string ToDevicePath(string name)
    {
        if (name.StartsWith(@"\??\", StringComparison.Ordinal)) return @"\\.\" + name[4..];
        return name.StartsWith('\\') ? name : @"\\.\" + name;
    }

    private static void WalkHub(string hubPath, Action<int, UsbId> onDevice, int depth)
    {
        // USB allows at most 5 tiers of hubs below the root hub.
        if (depth > 6) return;
        using var hub = Native.CreateFile(hubPath, Native.GENERIC_WRITE, Native.FILE_SHARE_WRITE, 0, Native.OPEN_EXISTING, 0, 0);
        if (hub.IsInvalid) return;

        // USB_NODE_INFORMATION (packed): NodeType (4), USB_HUB_DESCRIPTOR (71), BusPowered (1).
        var node = stackalloc byte[76];
        if (!Native.DeviceIoControl(hub, IOCTL_USB_GET_NODE_INFORMATION, node, 76, node, 76, out _, null)) return;
        int ports = node[4 + 2]; // HubDescriptor.bNumberOfPorts

        // USB_NODE_CONNECTION_INFORMATION_EX (packed): ConnectionIndex (4), USB_DEVICE_DESCRIPTOR (18),
        // CurrentConfigurationValue (1), Speed (1), DeviceIsHub (1), DeviceAddress (2),
        // NumberOfOpenPipes (4), ConnectionStatus (4), then the open pipes (11 bytes each).
        const int size = 35 + 32 * 11;
        var info = stackalloc byte[size];
        for (var port = 1; port <= ports; port++)
        {
            new Span<byte>(info, size).Clear();
            BinaryPrimitives.WriteUInt32LittleEndian(new Span<byte>(info, 4), (uint)port);
            if (!Native.DeviceIoControl(hub, IOCTL_USB_GET_NODE_CONNECTION_INFORMATION_EX, info, size, info, size, out _, null))
                continue;
            var span = new ReadOnlySpan<byte>(info, size);
            const int DeviceConnected = 1;
            if (BinaryPrimitives.ReadUInt32LittleEndian(span[31..]) != DeviceConnected) continue;

            var id = new UsbId(BinaryPrimitives.ReadUInt16LittleEndian(span[12..]), BinaryPrimitives.ReadUInt16LittleEndian(span[14..]));
            var isHub = span[24] != 0;
            var address = BinaryPrimitives.ReadUInt16LittleEndian(span[25..]);
            if (!isHub)
            {
                onDevice(address, id);
                continue;
            }
            var child = ChildHubName(hub, port);
            if (child != null) WalkHub(ToDevicePath(child), onDevice, depth + 1);
        }
    }

    private static string? ChildHubName(SafeFileHandle hub, int port)
    {
        // USB_NODE_CONNECTION_NAME: ConnectionIndex (4), ActualLength (4), NodeName (WCHAR[]).
        const int size = 8 + 1024 * sizeof(char);
        var buffer = stackalloc byte[size];
        new Span<byte>(buffer, size).Clear();
        *(uint*)buffer = (uint)port;
        if (!Native.DeviceIoControl(hub, IOCTL_USB_GET_NODE_CONNECTION_NAME, buffer, size, buffer, size, out _, null))
            return null;
        var name = new string((char*)(buffer + 8)).TrimEnd('\0');
        return name.Length > 0 ? name : null;
    }

    /// <summary>True if the USBPcap driver is installed (it may still need a reboot to attach).</summary>
    public static bool UsbPcapInstalled() =>
        Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\USBPcap") != null;
}

internal static class Win32Error
{
    public static string Message(int code) => $"{new System.ComponentModel.Win32Exception(code).Message} ({code})";
}

internal sealed class Win32ErrorException(int code, string action) : Exception($"{action}: {Win32Error.Message(code)}")
{
    public int Code { get; } = code;
}
