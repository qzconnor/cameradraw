using System.Runtime.InteropServices;
using static CameraDrawButtons.Native;

namespace CameraDrawButtons;

/// <summary>
/// Installs the service (needs admin rights). The executable is copied to Program Files first:
/// a service running as SYSTEM must not start from a folder the user can write to, otherwise any
/// program could replace it and gain SYSTEM rights.
/// </summary>
internal static unsafe class Installer
{
    private const string DisplayName = "CameraDraw Buttons";
    private const string Description = "Meldet die Foto-Taste von USB-Kameras (UVC) an CameraDraw. Liest dazu über USBPcap mit.";

    public static string InstallDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "CameraDraw Buttons");
    private static string InstalledExe => Path.Combine(InstallDir, "cameradraw-buttons.exe");
    public static string DataDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CameraDraw Buttons");

    /// <summary>Installs or updates the service and starts it. Returns 0 or a Win32 error code.</summary>
    public static int Install()
    {
        var manager = OpenSCManager(null, null, SC_MANAGER_ALL_ACCESS);
        if (manager == 0) return Marshal.GetLastPInvokeError();
        nint service = 0;
        try
        {
            service = OpenService(manager, ServiceHost.ServiceName, SERVICE_ALL_ACCESS);
            if (service != 0) StopAndWait(service);
            CopyExecutable();

            var path = $"\"{InstalledExe}\"";
            if (service == 0)
            {
                service = CreateService(manager, ServiceHost.ServiceName, DisplayName, SERVICE_ALL_ACCESS, SERVICE_WIN32_OWN_PROCESS,
                    SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, path, null, 0, null, null, null);
                if (service == 0) return Marshal.GetLastPInvokeError();
            }
            else if (!ChangeServiceConfig(service, SERVICE_WIN32_OWN_PROCESS, SERVICE_AUTO_START, SERVICE_ERROR_NORMAL, path, null, 0, null, null, null, DisplayName))
            {
                return Marshal.GetLastPInvokeError();
            }

            Configure(service);
            const int ERROR_SERVICE_ALREADY_RUNNING = 1056;
            if (!StartService(service, 0, 0) && Marshal.GetLastPInvokeError() is var error and not ERROR_SERVICE_ALREADY_RUNNING)
                return error;
            return 0;
        }
        catch (Win32ErrorException ex)
        {
            return ex.Code;
        }
        catch (Exception ex)
        {
            return ex.HResult & 0xFFFF;
        }
        finally
        {
            if (service != 0) CloseServiceHandle(service);
            CloseServiceHandle(manager);
        }
    }

    /// <summary>Stops and removes the service and its files. Returns 0 or a Win32 error code.</summary>
    public static int Uninstall()
    {
        var manager = OpenSCManager(null, null, SC_MANAGER_ALL_ACCESS);
        if (manager == 0) return Marshal.GetLastPInvokeError();
        try
        {
            var service = OpenService(manager, ServiceHost.ServiceName, SERVICE_ALL_ACCESS);
            if (service != 0)
            {
                try
                {
                    StopAndWait(service);
                    if (!DeleteService(service)) return Marshal.GetLastPInvokeError();
                }
                finally
                {
                    CloseServiceHandle(service);
                }
            }
            DeleteFolder(InstallDir);
            DeleteFolder(DataDir);
            return 0;
        }
        finally
        {
            CloseServiceHandle(manager);
        }
    }

    private static void Configure(nint service)
    {
        fixed (char* description = Description)
        {
            var info = description; // SERVICE_DESCRIPTIONW
            ChangeServiceConfig2(service, SERVICE_CONFIG_DESCRIPTION, &info);
        }

        // Restart after a crash (5 s), counter resets after a day.
        const uint SC_ACTION_RESTART = 1;
        var actions = stackalloc SC_ACTION[3];
        for (var i = 0; i < 3; i++) actions[i] = new SC_ACTION { Type = SC_ACTION_RESTART, Delay = 5000 };
        var failure = new SERVICE_FAILURE_ACTIONS { ResetPeriod = 24 * 60 * 60, ActionCount = 3, Actions = actions };
        ChangeServiceConfig2(service, SERVICE_CONFIG_FAILURE_ACTIONS, &failure);

        // Drop all privileges SYSTEM would have – reading USBPcap and serving a pipe need none.
        fixed (char* privileges = "SeChangeNotifyPrivilege\0")
        {
            var info = privileges; // SERVICE_REQUIRED_PRIVILEGES_INFOW, multi-string
            ChangeServiceConfig2(service, SERVICE_CONFIG_REQUIRED_PRIVILEGES_INFO, &info);
        }
    }

    private static void StopAndWait(nint service)
    {
        SERVICE_STATUS status;
        ControlService(service, SERVICE_CONTROL_STOP, &status);
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (QueryServiceStatus(service, &status) && status.CurrentState != SERVICE_STOPPED && DateTime.UtcNow < deadline)
            Thread.Sleep(200);
    }

    private static void CopyExecutable()
    {
        var source = Environment.ProcessPath ?? throw new InvalidOperationException("Programmpfad unbekannt");
        if (string.Equals(Path.GetFullPath(source), InstalledExe, StringComparison.OrdinalIgnoreCase)) return;
        Directory.CreateDirectory(InstallDir);
        // The stopped service process may need a moment to release its file.
        Retry(() => File.Copy(source, InstalledExe, overwrite: true));
    }

    private static void DeleteFolder(string path)
    {
        if (Directory.Exists(path)) Retry(() => Directory.Delete(path, recursive: true));
    }

    private static void Retry(Action action)
    {
        for (var attempt = 1; ; attempt++)
        {
            try
            {
                action();
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException && attempt < 25)
            {
                Thread.Sleep(200);
            }
        }
    }
}
