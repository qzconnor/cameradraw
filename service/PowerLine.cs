using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;

namespace CameraDrawButtons;

// Output of `cameradraw-buttons powerline v:p [value]`: one JSON object on stdout.
//
//   {"value":1,"min":1,"max":2,"default":2}     the current value (after setting `value`, if given)
//   {"error":"device-missing"}                  also: unsupported · rejected

internal sealed record PowerLineState(int Value, int Min, int Max, int Default);

internal sealed record PowerLineError(string Error);

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PowerLineState))]
[JsonSerializable(typeof(PowerLineError))]
internal sealed partial class PowerLineJson : JsonSerializerContext;

/// <summary>
/// Reads or sets a camera's anti-flicker filter: the UVC power line frequency of the processing unit,
/// 0 = off, 1 = 50 Hz, 2 = 60 Hz. Browsers offer no control for it, and Logitech webcams start with
/// 60 Hz – lamps on 50 Hz mains then flicker in the picture. Needs no admin rights and works while
/// another program streams from the camera.
/// </summary>
internal static unsafe class PowerLine
{
    // CTL_CODE(FILE_DEVICE_KS, 0x000, METHOD_NEITHER, FILE_ANY_ACCESS)
    private const uint IOCTL_KS_PROPERTY = 0x2F0003;
    private const uint KSPROPERTY_TYPE_GET = 1;
    private const uint KSPROPERTY_TYPE_SET = 2;
    private const uint KSPROPERTY_TYPE_BASICSUPPORT = 0x200;
    private const uint KSPROPERTY_TYPE_DEFAULTVALUES = 0x10000;
    private const uint KSPROPERTY_VIDEOPROCAMP_POWERLINE_FREQUENCY = 13;
    private const uint KSPROPERTY_VIDEOPROCAMP_FLAGS_MANUAL = 2;
    private static readonly Guid PROPSETID_VIDCAP_VIDEOPROCAMP = new("C6E13360-30AC-11d0-A18C-00A0C9118956");
    private static readonly Guid KSCATEGORY_VIDEO = new("6994AD05-93EF-11D0-A3CC-00A0C9223196");

    /// <summary>KSPROPERTY_VIDEOPROCAMP_S – 40 bytes, KSPROPERTY is 8-byte aligned.</summary>
    private struct VideoProcAmpProperty
    {
        public Guid Set;
        public uint Id;
        public uint PropertyFlags;
        public int Value;
        public uint Flags;
        public uint Capabilities;
        private uint _padding;
    }

    // Answers to BASICSUPPORT and DEFAULTVALUES: KSPROPERTY_DESCRIPTION (40 bytes), then
    // KSPROPERTY_MEMBERSHEADER (16 bytes), then the members – KSPROPERTY_STEPPING_LONG
    // (delta, reserved, minimum, maximum) or the default value.
    private const int MembersOffset = 40 + 16;

    public static int Run(UsbId id, int? value)
    {
        var path = Native.DeviceInterfaces(KSCATEGORY_VIDEO)
            .FirstOrDefault(p => p.Contains($"vid_{id.VendorId:x4}&pid_{id.ProductId:x4}", StringComparison.OrdinalIgnoreCase));
        if (path == null) return Fail("device-missing", 2);
        using var device = Native.CreateFile(path, Native.GENERIC_READ, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, 0, Native.OPEN_EXISTING, 0, 0);
        if (device.IsInvalid) return Fail("device-missing", 2);

        var range = stackalloc byte[128];
        if (!Query(device, KSPROPERTY_TYPE_BASICSUPPORT, range, 128, MembersOffset + 16)) return Fail("unsupported", 3);
        var min = *(int*)(range + MembersOffset + 8);
        var max = *(int*)(range + MembersOffset + 12);
        var defaults = stackalloc byte[128];
        var fallback = Query(device, KSPROPERTY_TYPE_DEFAULTVALUES, defaults, 128, MembersOffset + 4) ? *(int*)(defaults + MembersOffset) : max;

        if (value is { } wanted)
        {
            if (wanted < min || wanted > max) return Fail("rejected", 3);
            var set = Request(KSPROPERTY_TYPE_SET);
            set.Value = wanted;
            set.Flags = KSPROPERTY_VIDEOPROCAMP_FLAGS_MANUAL;
            if (!Native.DeviceIoControl(device, IOCTL_KS_PROPERTY, &set, sizeof(VideoProcAmpProperty), &set, sizeof(VideoProcAmpProperty), out _, null))
                return Fail("rejected", 3);
        }

        var get = Request(KSPROPERTY_TYPE_GET);
        var current = get;
        if (!Native.DeviceIoControl(device, IOCTL_KS_PROPERTY, &get, sizeof(VideoProcAmpProperty), &current, sizeof(VideoProcAmpProperty), out _, null))
            return Fail("unsupported", 3);
        Write(JsonSerializer.Serialize(new PowerLineState(current.Value, min, max, fallback), PowerLineJson.Default.PowerLineState));
        return 0;
    }

    private static VideoProcAmpProperty Request(uint flags) => new()
    {
        Set = PROPSETID_VIDCAP_VIDEOPROCAMP,
        Id = KSPROPERTY_VIDEOPROCAMP_POWERLINE_FREQUENCY,
        PropertyFlags = flags
    };

    private static bool Query(SafeFileHandle device, uint flags, byte* output, int size, int needed)
    {
        var request = Request(flags);
        return Native.DeviceIoControl(device, IOCTL_KS_PROPERTY, &request, sizeof(VideoProcAmpProperty), output, size, out var returned, null) && returned >= needed;
    }

    private static int Fail(string error, int code)
    {
        Write(JsonSerializer.Serialize(new PowerLineError(error), PowerLineJson.Default.PowerLineError));
        return code;
    }

    private static void Write(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }
}
