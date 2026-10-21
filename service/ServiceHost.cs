using System.Runtime.InteropServices;
using static CameraDrawButtons.Native;

namespace CameraDrawButtons;

/// <summary>Minimal Windows service plumbing (service control dispatcher + control handler).</summary>
internal static unsafe class ServiceHost
{
    public const string ServiceName = "CameraDrawButtons";

    private static Func<CancellationToken, Task>? _run;
    private static readonly CancellationTokenSource Stop = new();
    private static nint _statusHandle;

    /// <summary>
    /// Runs as a service until it is stopped. Returns false if the process was not started by the
    /// service control manager (e.g. double-clicked).
    /// </summary>
    public static bool TryRun(Func<CancellationToken, Task> run)
    {
        _run = run;
        fixed (char* name = ServiceName)
        {
            var table = stackalloc SERVICE_TABLE_ENTRY[2];
            table[0] = new SERVICE_TABLE_ENTRY { ServiceName = name, ServiceProc = &ServiceMain };
            table[1] = default;
            if (StartServiceCtrlDispatcher(table)) return true;
            var error = Marshal.GetLastPInvokeError();
            if (error == ERROR_FAILED_SERVICE_CONTROLLER_CONNECT) return false;
            throw new Win32ErrorException(error, "Dienst starten");
        }
    }

    [UnmanagedCallersOnly]
    private static void ServiceMain(uint argc, char** argv)
    {
        _statusHandle = RegisterServiceCtrlHandlerEx(ServiceName, &Handler, 0);
        Report(SERVICE_START_PENDING);
        uint exitCode = 0;
        try
        {
            var task = _run!(Stop.Token);
            Report(SERVICE_RUNNING);
            task.GetAwaiter().GetResult();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            Log.Write($"Dienst beendet: {ex}");
            exitCode = 1;
        }
        Report(SERVICE_STOPPED, exitCode);
    }

    [UnmanagedCallersOnly]
    private static uint Handler(uint control, uint eventType, nint eventData, nint context)
    {
        switch (control)
        {
            case SERVICE_CONTROL_STOP:
            case SERVICE_CONTROL_SHUTDOWN:
                Report(SERVICE_STOP_PENDING);
                // Return to the service control manager right away; stopping happens on the pool.
                ThreadPool.QueueUserWorkItem(_ => Stop.Cancel());
                return 0;
            case SERVICE_CONTROL_INTERROGATE:
                return 0;
            default:
                const uint ERROR_CALL_NOT_IMPLEMENTED = 120;
                return ERROR_CALL_NOT_IMPLEMENTED;
        }
    }

    private static void Report(uint state, uint exitCode = 0)
    {
        const uint ERROR_SERVICE_SPECIFIC_ERROR = 1066;
        var status = new SERVICE_STATUS
        {
            ServiceType = SERVICE_WIN32_OWN_PROCESS,
            CurrentState = state,
            ControlsAccepted = state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0,
            Win32ExitCode = exitCode == 0 ? 0 : ERROR_SERVICE_SPECIFIC_ERROR,
            ServiceSpecificExitCode = exitCode,
            WaitHint = state is SERVICE_START_PENDING or SERVICE_STOP_PENDING ? 10_000u : 0
        };
        SetServiceStatus(_statusHandle, &status);
    }
}
