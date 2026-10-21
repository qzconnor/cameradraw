using System.Buffers.Binary;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace CameraDrawButtons;

/// <summary>
/// Captures the USB traffic of some devices on one root hub through USBPcap and reports UVC
/// still-image button packets. USBPcap allows only one capture per root hub at a time.
/// </summary>
internal sealed unsafe class UsbPcapCapture : IDisposable
{
    // CTL_CODE(FILE_DEVICE_UNKNOWN, 0x800 + n, METHOD_BUFFERED, …), see USBPcap.h
    private const uint IOCTL_USBPCAP_SETUP_BUFFER = 0x226000;
    private const uint IOCTL_USBPCAP_START_FILTERING = 0x22E004;
    private const uint IOCTL_USBPCAP_SET_SNAPLEN_SIZE = 0x226010;

    /// <summary>Only the start of each packet is needed (27-byte USBPcap header + 4-byte status).</summary>
    private const int SnapLength = 128;
    private const int KernelBufferSize = 1024 * 1024;
    private const int ReadBufferSize = 64 * 1024;

    public string Filter { get; }
    public IReadOnlySet<int> Addresses { get; }

    private readonly SafeFileHandle _handle;
    private readonly Thread _thread;
    private readonly ManualResetEvent _stop = new(false);
    private readonly Action<int, bool> _onButton;
    private readonly Action<UsbPcapCapture, Exception> _onFailed;

    /// <param name="onButton">USB address, pressed – called on the capture thread.</param>
    /// <param name="onFailed">Called on the capture thread if reading fails.</param>
    public UsbPcapCapture(string filter, IReadOnlySet<int> addresses, Action<int, bool> onButton, Action<UsbPcapCapture, Exception> onFailed)
    {
        Filter = filter;
        Addresses = addresses;
        _onButton = onButton;
        _onFailed = onFailed;

        _handle = Native.CreateFile(filter, Native.GENERIC_READ | Native.GENERIC_WRITE, 0, 0, Native.OPEN_EXISTING, Native.FILE_FLAG_OVERLAPPED, 0);
        if (_handle.IsInvalid) throw new Win32ErrorException(Marshal.GetLastPInvokeError(), $"{filter} öffnen");
        try
        {
            SetSize(IOCTL_USBPCAP_SET_SNAPLEN_SIZE, SnapLength);
            SetSize(IOCTL_USBPCAP_SETUP_BUFFER, KernelBufferSize);

            // USBPCAP_ADDRESS_FILTER (packed): UINT32 addresses[4] as a bitmap of USB addresses, BOOLEAN filterAll.
            var addressFilter = stackalloc byte[17];
            new Span<byte>(addressFilter, 17).Clear();
            foreach (var address in addresses)
            {
                if (address is < 1 or > 127) continue;
                ((uint*)addressFilter)[address / 32] |= 1u << (address % 32);
            }
            var error = Native.Ioctl(_handle, IOCTL_USBPCAP_START_FILTERING, addressFilter, 17, null, 0, out _);
            if (error != 0) throw new Win32ErrorException(error, "Aufzeichnung starten");
        }
        catch
        {
            _handle.Dispose();
            throw;
        }

        _thread = new Thread(ReadLoop) { IsBackground = true, Name = $"capture {filter}" };
        _thread.Start();
    }

    private void SetSize(uint code, int size)
    {
        var value = (uint)size;
        var error = Native.Ioctl(_handle, code, &value, sizeof(uint), null, 0, out _);
        if (error != 0) throw new Win32ErrorException(error, "USBPcap einrichten");
    }

    private void ReadLoop()
    {
        var buffer = (byte*)NativeMemory.Alloc(ReadBufferSize);
        var overlapped = (NativeOverlapped*)NativeMemory.AllocZeroed((nuint)sizeof(NativeOverlapped));
        using var readDone = new ManualResetEvent(false);
        var parser = new PcapStreamParser(_onButton);
        WaitHandle[] waits = [readDone, _stop];
        try
        {
            while (true)
            {
                readDone.Reset();
                *overlapped = default;
                overlapped->EventHandle = readDone.SafeWaitHandle.DangerousGetHandle();
                if (!Native.ReadFile(_handle, buffer, ReadBufferSize, out _, overlapped))
                {
                    var error = Marshal.GetLastPInvokeError();
                    if (error != Native.ERROR_IO_PENDING) throw new Win32ErrorException(error, "Lesen");
                }
                if (WaitHandle.WaitAny(waits) == 1)
                {
                    Native.CancelIoEx(_handle, overlapped);
                    Native.GetOverlappedResult(_handle, overlapped, out _, true);
                    return;
                }
                if (!Native.GetOverlappedResult(_handle, overlapped, out var read, false))
                    throw new Win32ErrorException(Marshal.GetLastPInvokeError(), "Lesen");
                parser.Feed(new ReadOnlySpan<byte>(buffer, read));
            }
        }
        catch (Exception ex)
        {
            if (!_stop.WaitOne(0)) _onFailed(this, ex);
        }
        finally
        {
            NativeMemory.Free(overlapped);
            NativeMemory.Free(buffer);
        }
    }

    public void Dispose()
    {
        _stop.Set();
        _thread.Join(TimeSpan.FromSeconds(5));
        _handle.Dispose();
        _stop.Dispose();
    }
}

/// <summary>
/// Reads the pcap stream written by USBPcap (records may be split across reads) and reports UVC
/// button status packets as (USB address, pressed).
/// </summary>
internal sealed class PcapStreamParser(Action<int, bool> onButton)
{
    private const uint PcapMagic = 0xA1B2C3D4;
    private const uint LinkTypeUsbPcap = 249;
    private const int GlobalHeaderSize = 24;
    private const int RecordHeaderSize = 16;
    private const int MaxRecordSize = 1024 * 1024;

    private byte[] _buffer = new byte[64 * 1024];
    private int _length;
    private bool _headerSeen;

    public void Feed(ReadOnlySpan<byte> data)
    {
        if (_length + data.Length > _buffer.Length) Array.Resize(ref _buffer, Math.Max(_buffer.Length * 2, _length + data.Length));
        data.CopyTo(_buffer.AsSpan(_length));
        _length += data.Length;

        var offset = 0;
        if (!_headerSeen)
        {
            if (_length < GlobalHeaderSize) return;
            var header = _buffer.AsSpan(0, GlobalHeaderSize);
            if (BinaryPrimitives.ReadUInt32LittleEndian(header) != PcapMagic || BinaryPrimitives.ReadUInt32LittleEndian(header[20..]) != LinkTypeUsbPcap)
                throw new InvalidDataException("Unerwartetes Datenformat von USBPcap.");
            _headerSeen = true;
            offset = GlobalHeaderSize;
        }

        while (_length - offset >= RecordHeaderSize)
        {
            var included = BinaryPrimitives.ReadUInt32LittleEndian(_buffer.AsSpan(offset + 8));
            if (included > MaxRecordSize) throw new InvalidDataException("Ungültiges Paket von USBPcap.");
            if (_length - offset - RecordHeaderSize < included) break;
            Packet(_buffer.AsSpan(offset + RecordHeaderSize, (int)included));
            offset += RecordHeaderSize + (int)included;
        }

        _buffer.AsSpan(offset, _length - offset).CopyTo(_buffer);
        _length -= offset;
    }

    /// <summary>One USBPcap packet: USBPCAP_BUFFER_PACKET_HEADER (packed, 27 bytes) + data.</summary>
    private void Packet(ReadOnlySpan<byte> packet)
    {
        if (packet.Length < 27) return;
        var headerLength = BinaryPrimitives.ReadUInt16LittleEndian(packet);
        var status = BinaryPrimitives.ReadInt32LittleEndian(packet[10..]);
        var info = packet[16];
        var address = BinaryPrimitives.ReadUInt16LittleEndian(packet[19..]);
        var endpoint = packet[21];
        var transfer = packet[22];

        const byte TransferInterrupt = 1;
        const byte InfoCompletion = 1; // USBPCAP_INFO_PDO_TO_FDO: the device answered
        if (transfer != TransferInterrupt || (endpoint & 0x80) == 0 || (info & InfoCompletion) == 0 || status != 0) return;
        if (headerLength < 27 || headerLength > packet.Length) return;
        if (UvcStatus.TryParseButton(packet[headerLength..], out var pressed)) onButton(address, pressed);
    }
}

internal static class UvcStatus
{
    /// <summary>
    /// UVC status packet from the VideoControl interrupt endpoint (UVC 1.5, 2.4.2.2):
    /// bStatusType (low nibble 2 = VideoStreaming interface), bOriginator (interface number),
    /// bEvent (0 = button press), bValue (1 = pressed, 0 = released).
    /// </summary>
    public static bool TryParseButton(ReadOnlySpan<byte> data, out bool pressed)
    {
        pressed = false;
        if (data.Length < 4 || (data[0] & 0x0F) != 2 || data[2] != 0) return false;
        pressed = data[3] != 0;
        return true;
    }
}
