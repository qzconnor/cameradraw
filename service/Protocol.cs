using System.Globalization;
using System.Text.Json.Serialization;

namespace CameraDrawButtons;

// Named pipe protocol: one JSON object per line (UTF-8), both directions.
//
// Client → service:  {"watch":[{"vendorId":"1b3f","productId":"2002"}]}   (replaces the client's list)
// Service → client:  {"type":"status",…}  on connect and whenever it changes
//                    {"type":"button","vendorId":"1b3f","productId":"2002","pressed":true}

internal sealed record DeviceRef(string VendorId, string ProductId)
{
    public static DeviceRef From(UsbId id) => new($"{id.VendorId:x4}", $"{id.ProductId:x4}");

    public bool TryGetId(out UsbId id)
    {
        id = default;
        if (VendorId is not { Length: 4 } || ProductId is not { Length: 4 }) return false;
        if (!ushort.TryParse(VendorId, NumberStyles.AllowHexSpecifier, null, out var vendor)) return false;
        if (!ushort.TryParse(ProductId, NumberStyles.AllowHexSpecifier, null, out var product)) return false;
        id = new UsbId(vendor, product);
        return true;
    }
}

internal sealed record ClientMessage(List<DeviceRef>? Watch);

internal sealed record DeviceStatus(string VendorId, string ProductId, bool Connected, bool Listening);

/// <summary>
/// State: idle (nothing watched) · ready · device-missing · usbpcap-missing · usbpcap-reboot
/// (installed, not attached to the root hubs yet) · usbpcap-busy (another capture runs) · error
/// </summary>
internal sealed record StatusMessage(string State, string? Message, List<DeviceStatus> Devices)
{
    public string Type => "status";
    public int Version => Protocol.Version;
}

internal sealed record ButtonMessage(string VendorId, string ProductId, bool Pressed)
{
    public string Type => "button";
}

internal static class Protocol
{
    /// <summary>Bump when the messages change incompatibly; the app then offers to update the service.</summary>
    public const int Version = 1;
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(ClientMessage))]
[JsonSerializable(typeof(StatusMessage))]
[JsonSerializable(typeof(ButtonMessage))]
internal sealed partial class ProtocolJson : JsonSerializerContext;
