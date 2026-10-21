using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32.SafeHandles;

namespace CameraDrawButtons;

// Output of `cameradraw-buttons brightness`: one JSON object per line on stdout.
//
//   {"type":"status","state":"ready"}          ready · device-missing · error (with "message")
//   {"type":"value","value":49}                 on the first read and on every change

internal sealed record PollStatusMessage(string State, string? Message)
{
    public string Type => "status";
}

internal sealed record PollValueMessage(int Value)
{
    public string Type => "value";
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(PollStatusMessage))]
[JsonSerializable(typeof(PollValueMessage))]
internal sealed partial class PollJson : JsonSerializerContext;

/// <summary>
/// Reads the UVC brightness (Processing Unit, selector 2) of a camera again and again and prints
/// every change. Some cameras report buttons this way – e.g. the Generalplus microscope 1b3f:2002
/// answers 0x33 once after Zoom + and 0x32 after Zoom −, otherwise 0x31. Only reads, never sets;
/// needs no admin rights and works while another program streams from the camera.
/// </summary>
internal static unsafe class BrightnessPoller
{
    // CTL_CODE(FILE_DEVICE_KS, 0x000, METHOD_NEITHER, FILE_ANY_ACCESS)
    private const uint IOCTL_KS_PROPERTY = 0x2F0003;
    private const uint KSPROPERTY_TYPE_GET = 1;
    private const uint KSPROPERTY_VIDEOPROCAMP_BRIGHTNESS = 0;
    private static readonly Guid PROPSETID_VIDCAP_VIDEOPROCAMP = new("C6E13360-30AC-11d0-A18C-00A0C9118956");
    private static readonly Guid KSCATEGORY_VIDEO = new("6994AD05-93EF-11D0-A3CC-00A0C9223196");

    private static readonly TimeSpan RescanInterval = TimeSpan.FromSeconds(2);

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

    /// <summary>Polls until stdin is closed (the app quit or stopped the poller).</summary>
    public static int Run(UsbId id, TimeSpan interval)
    {
        var stdinClosed = new Thread(() =>
        {
            try
            {
                while (Console.In.Read() >= 0)
                {
                }
            }
            catch (IOException)
            {
            }
            Environment.Exit(0);
        }) { IsBackground = true };
        stdinClosed.Start();

        string? lastState = null;
        void Status(string state, string? message = null)
        {
            if (state == lastState && message == null) return;
            lastState = state;
            Write(JsonSerializer.Serialize(new PollStatusMessage(state, message), PollJson.Default.PollStatusMessage));
        }

        while (true)
        {
            var path = FindVideoInterface(id);
            if (path == null)
            {
                Status("device-missing");
                Thread.Sleep(RescanInterval);
                continue;
            }
            using var device = Native.CreateFile(path, Native.GENERIC_READ, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE, 0, Native.OPEN_EXISTING, 0, 0);
            if (device.IsInvalid)
            {
                Status("error", new Win32ErrorException(System.Runtime.InteropServices.Marshal.GetLastPInvokeError(), "Kamera öffnen").Message);
                Thread.Sleep(RescanInterval);
                continue;
            }

            int? last = null;
            var timer = Stopwatch.StartNew();
            // Unplugged: the read fails – look for the device again.
            while (TryReadBrightness(device, out var value))
            {
                Status("ready");
                if (value != last)
                {
                    last = value;
                    Write(JsonSerializer.Serialize(new PollValueMessage(value), PollJson.Default.PollValueMessage));
                }
                var wait = interval - timer.Elapsed;
                if (wait > TimeSpan.Zero) Thread.Sleep(wait);
                timer.Restart();
            }
            Status("device-missing");
            Thread.Sleep(RescanInterval);
        }
    }

    private static void Write(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    private static bool TryReadBrightness(SafeFileHandle device, out int value)
    {
        var request = new VideoProcAmpProperty
        {
            Set = PROPSETID_VIDCAP_VIDEOPROCAMP,
            Id = KSPROPERTY_VIDEOPROCAMP_BRIGHTNESS,
            PropertyFlags = KSPROPERTY_TYPE_GET
        };
        var result = request;
        var ok = Native.DeviceIoControl(device, IOCTL_KS_PROPERTY, &request, sizeof(VideoProcAmpProperty), &result, sizeof(VideoProcAmpProperty), out _, null);
        value = result.Value;
        return ok;
    }

    /// <summary>The camera's video capture interface, e.g. <c>\\?\USB#VID_1B3F&amp;PID_2002&amp;MI_00#…</c>.</summary>
    private static string? FindVideoInterface(UsbId id)
    {
        var token = $"vid_{id.VendorId:x4}&pid_{id.ProductId:x4}";
        return Native.DeviceInterfaces(KSCATEGORY_VIDEO).FirstOrDefault(path => path.Contains(token, StringComparison.OrdinalIgnoreCase));
    }
}
