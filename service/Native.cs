using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace CameraDrawButtons;

/// <summary>Win32 functions and constants used by the service.</summary>
internal static unsafe partial class Native
{
    public const uint GENERIC_READ = 0x80000000;
    public const uint GENERIC_WRITE = 0x40000000;
    public const uint FILE_SHARE_READ = 1;
    public const uint FILE_SHARE_WRITE = 2;
    public const uint OPEN_EXISTING = 3;
    public const uint FILE_FLAG_OVERLAPPED = 0x40000000;

    public const int ERROR_FILE_NOT_FOUND = 2;
    public const int ERROR_ACCESS_DENIED = 5;
    public const int ERROR_SHARING_VIOLATION = 32;
    public const int ERROR_IO_PENDING = 997;
    public const int ERROR_OPERATION_ABORTED = 995;
    public const int ERROR_SERVICE_DOES_NOT_EXIST = 1060;
    public const int ERROR_SERVICE_NOT_ACTIVE = 1062;
    public const int ERROR_FAILED_SERVICE_CONTROLLER_CONNECT = 1063;

    // --- Files and devices -------------------------------------------------------------------

    [LibraryImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial SafeFileHandle CreateFile(string name, uint access, uint share, nint security, uint disposition, uint flags, nint template);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool DeviceIoControl(SafeFileHandle device, uint code, void* inBuffer, int inSize, void* outBuffer, int outSize, out int returned, NativeOverlapped* overlapped);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ReadFile(SafeFileHandle file, byte* buffer, int size, out int read, NativeOverlapped* overlapped);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetOverlappedResult(SafeFileHandle file, NativeOverlapped* overlapped, out int transferred, [MarshalAs(UnmanagedType.Bool)] bool wait);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool CancelIoEx(SafeFileHandle file, NativeOverlapped* overlapped);

    /// <summary>
    /// DeviceIoControl on a handle opened with FILE_FLAG_OVERLAPPED: waits for the request to finish.
    /// Returns 0 on success, otherwise the Win32 error code.
    /// </summary>
    public static int Ioctl(SafeFileHandle device, uint code, void* inBuffer, int inSize, void* outBuffer, int outSize, out int returned)
    {
        using var done = new ManualResetEvent(false);
        var overlapped = (NativeOverlapped*)NativeMemory.AllocZeroed((nuint)sizeof(NativeOverlapped));
        try
        {
            overlapped->EventHandle = done.SafeWaitHandle.DangerousGetHandle();
            if (DeviceIoControl(device, code, inBuffer, inSize, outBuffer, outSize, out returned, overlapped)) return 0;
            var error = Marshal.GetLastPInvokeError();
            if (error != ERROR_IO_PENDING) return error;
            return GetOverlappedResult(device, overlapped, out returned, true) ? 0 : Marshal.GetLastPInvokeError();
        }
        finally
        {
            NativeMemory.Free(overlapped);
        }
    }

    // --- Device interfaces ---------------------------------------------------------------------

    private const int CR_SUCCESS = 0;
    private const int CR_BUFFER_SMALL = 0x1A;

    [LibraryImport("cfgmgr32.dll", EntryPoint = "CM_Get_Device_Interface_List_SizeW")]
    private static partial int CM_Get_Device_Interface_List_Size(out int length, Guid* interfaceClass, char* deviceId, int flags);

    [LibraryImport("cfgmgr32.dll", EntryPoint = "CM_Get_Device_Interface_ListW")]
    private static partial int CM_Get_Device_Interface_List(Guid* interfaceClass, char* deviceId, char* buffer, int length, int flags);

    /// <summary>Paths of all present device interfaces of a class.</summary>
    public static string[] DeviceInterfaces(Guid interfaceClass)
    {
        while (true)
        {
            if (CM_Get_Device_Interface_List_Size(out var length, &interfaceClass, null, 0) != CR_SUCCESS || length <= 1) return [];
            var buffer = new char[length];
            int result;
            fixed (char* chars = buffer) result = CM_Get_Device_Interface_List(&interfaceClass, null, chars, length, 0);
            // A device arrived in between – ask for the size again.
            if (result == CR_BUFFER_SMALL) continue;
            return result == CR_SUCCESS ? new string(buffer).Split('\0', StringSplitOptions.RemoveEmptyEntries) : [];
        }
    }

    // --- Services ----------------------------------------------------------------------------

    public const uint SC_MANAGER_ALL_ACCESS = 0xF003F;
    public const uint SERVICE_ALL_ACCESS = 0xF01FF;
    public const uint SERVICE_WIN32_OWN_PROCESS = 0x10;
    public const uint SERVICE_AUTO_START = 2;
    public const uint SERVICE_ERROR_NORMAL = 1;
    public const uint SERVICE_NO_CHANGE = 0xFFFFFFFF;

    public const uint SERVICE_STOPPED = 1;
    public const uint SERVICE_START_PENDING = 2;
    public const uint SERVICE_STOP_PENDING = 3;
    public const uint SERVICE_RUNNING = 4;

    public const uint SERVICE_CONTROL_STOP = 1;
    public const uint SERVICE_CONTROL_INTERROGATE = 4;
    public const uint SERVICE_CONTROL_SHUTDOWN = 5;
    public const uint SERVICE_ACCEPT_STOP = 1;
    public const uint SERVICE_ACCEPT_SHUTDOWN = 4;

    public const uint SERVICE_CONFIG_DESCRIPTION = 1;
    public const uint SERVICE_CONFIG_FAILURE_ACTIONS = 2;
    public const uint SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO = 6;

    [StructLayout(LayoutKind.Sequential)]
    public struct SERVICE_STATUS
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SERVICE_TABLE_ENTRY
    {
        public char* ServiceName;
        public delegate* unmanaged<uint, char**, void> ServiceProc;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SC_ACTION
    {
        public uint Type;
        public uint Delay;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SERVICE_FAILURE_ACTIONS
    {
        public uint ResetPeriod;
        public char* RebootMsg;
        public char* Command;
        public uint ActionCount;
        public SC_ACTION* Actions;
    }

    [LibraryImport("advapi32.dll", EntryPoint = "OpenSCManagerW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint OpenSCManager(string? machine, string? database, uint access);

    [LibraryImport("advapi32.dll", EntryPoint = "OpenServiceW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint OpenService(nint manager, string name, uint access);

    [LibraryImport("advapi32.dll", EntryPoint = "CreateServiceW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint CreateService(nint manager, string name, string displayName, uint access, uint serviceType, uint startType, uint errorControl, string binaryPath, string? loadOrderGroup, nint tagId, string? dependencies, string? account, string? password);

    [LibraryImport("advapi32.dll", EntryPoint = "ChangeServiceConfigW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ChangeServiceConfig(nint service, uint serviceType, uint startType, uint errorControl, string? binaryPath, string? loadOrderGroup, nint tagId, string? dependencies, string? account, string? password, string? displayName);

    [LibraryImport("advapi32.dll", EntryPoint = "ChangeServiceConfig2W", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ChangeServiceConfig2(nint service, uint infoLevel, void* info);

    [LibraryImport("advapi32.dll", EntryPoint = "StartServiceW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool StartService(nint service, uint argCount, nint args);

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool ControlService(nint service, uint control, SERVICE_STATUS* status);

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool QueryServiceStatus(nint service, SERVICE_STATUS* status);

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool DeleteService(nint service);

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool CloseServiceHandle(nint handle);

    [LibraryImport("advapi32.dll", EntryPoint = "StartServiceCtrlDispatcherW", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool StartServiceCtrlDispatcher(SERVICE_TABLE_ENTRY* table);

    [LibraryImport("advapi32.dll", EntryPoint = "RegisterServiceCtrlHandlerExW", SetLastError = true, StringMarshalling = StringMarshalling.Utf16)]
    public static partial nint RegisterServiceCtrlHandlerEx(string name, delegate* unmanaged<uint, uint, nint, nint, uint> handler, nint context);

    [LibraryImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetServiceStatus(nint handle, SERVICE_STATUS* status);
}
