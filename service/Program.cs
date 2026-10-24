using CameraDrawButtons;

// CameraDraw Buttons – Windows service that reports UVC still-image button presses (e.g. the photo
// button of a USB microscope) to CameraDraw. Windows' camera driver consumes these packets, so the
// service reads them from the USB traffic via USBPcap and serves them on a named pipe.

Console.OutputEncoding = System.Text.Encoding.UTF8;

return args.FirstOrDefault()?.ToLowerInvariant() switch
{
    null => RunService(),
    "install" => Installer.Install(),
    "uninstall" => Installer.Uninstall(),
    "console" => RunConsole(args[1..]),
    "devices" => ListDevices(),
    "parse" when args.Length == 2 => Parse(args[1]),
    "brightness" when args.Length is 2 or 3 => PollBrightness(args[1], args.ElementAtOrDefault(2)),
    "powerline" when args.Length is 2 or 3 => SetPowerLine(args[1], args.ElementAtOrDefault(2)),
    _ => Usage()
};

static int RunService()
{
    var started = ServiceHost.TryRun(cancel =>
    {
        Log.UseFile(Path.Combine(Installer.DataDir, "service.log"));
        return Run(cancel, new HashSet<UsbId>());
    });
    return started ? 0 : Usage();
}

static async Task Run(CancellationToken cancel, IReadOnlySet<UsbId> watch)
{
    Log.Write($"Gestartet (Protokoll {Protocol.Version})");
    var monitor = new ButtonMonitor();
    monitor.StatusChanged += status => Log.Write($"Status: {status.State}{(status.Message == null ? "" : $" – {status.Message}")}");
    monitor.Button += (id, pressed) => Log.Write($"Taste {id}: {(pressed ? "gedrückt" : "losgelassen")}");
    if (watch.Count > 0) monitor.SetWatch(monitor, watch);

    using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancel);
    Task[] tasks = [monitor.RunAsync(stop.Token), new PipeServer(monitor).RunAsync(stop.Token)];
    await Task.WhenAny(tasks);
    stop.Cancel();
    try
    {
        await Task.WhenAll(tasks);
    }
    finally
    {
        Log.Write("Beendet");
    }
}

/// <summary>Runs in the foreground (needs admin rights), optionally watching devices given as vid:pid.</summary>
static int RunConsole(string[] devices)
{
    var watch = new HashSet<UsbId>();
    foreach (var device in devices)
    {
        var parts = device.Split(':');
        if (parts.Length != 2 || !new DeviceRef(parts[0], parts[1]).TryGetId(out var id)) return Usage();
        watch.Add(id);
    }
    using var cancel = new CancellationTokenSource();
    Console.CancelKeyPress += (_, e) =>
    {
        e.Cancel = true;
        cancel.Cancel();
    };
    Console.WriteLine("Läuft – Strg+C beendet.");
    try
    {
        Run(cancel.Token, watch).GetAwaiter().GetResult();
    }
    catch (OperationCanceledException)
    {
    }
    return 0;
}

static int ListDevices()
{
    var filters = UsbTopology.Filters();
    if (filters.Count == 0)
    {
        Console.WriteLine(UsbTopology.UsbPcapInstalled() ? "USBPcap ist installiert, aber noch nicht aktiv (Neustart nötig)." : "USBPcap ist nicht installiert.");
        return 1;
    }
    foreach (var (id, location) in UsbTopology.Devices(filters))
        Console.WriteLine($"{location.Filter,-16} Adresse {location.Address,3}   {id}");
    return 0;
}

/// <summary>Finds button packets in a capture file written by USBPcapCMD (pcap format).</summary>
static int Parse(string file)
{
    var parser = new PcapStreamParser((address, pressed) => Console.WriteLine($"Adresse {address}: {(pressed ? "gedrückt" : "losgelassen")}"));
    parser.Feed(File.ReadAllBytes(file));
    return 0;
}

/// <summary>Prints the camera's UVC brightness on every change until stdin closes (no admin rights).</summary>
static int PollBrightness(string device, string? intervalMs)
{
    var parts = device.Split(':');
    if (parts.Length != 2 || !new DeviceRef(parts[0], parts[1]).TryGetId(out var id)) return Usage();
    var interval = 65;
    if (intervalMs != null && (!int.TryParse(intervalMs, out interval) || interval is < 10 or > 10_000)) return Usage();
    return BrightnessPoller.Run(id, TimeSpan.FromMilliseconds(interval));
}

/// <summary>Reads, or sets and then reads, the camera's anti-flicker filter (no admin rights).</summary>
static int SetPowerLine(string device, string? value)
{
    var parts = device.Split(':');
    if (parts.Length != 2 || !new DeviceRef(parts[0], parts[1]).TryGetId(out var id)) return Usage();
    if (value == null) return PowerLine.Run(id, null);
    return int.TryParse(value, out var wanted) && wanted is >= 0 and <= 3 ? PowerLine.Run(id, wanted) : Usage();
}

static int Usage()
{
    Console.WriteLine("""
        CameraDraw Buttons – meldet die Tasten von USB-Kameras an CameraDraw.

          cameradraw-buttons install             Dienst installieren/aktualisieren und starten (Admin)
          cameradraw-buttons uninstall           Dienst entfernen (Admin)
          cameradraw-buttons console [v:p …]     im Vordergrund ausführen, z. B. console 1b3f:2002 (Admin)
          cameradraw-buttons devices             USB-Geräte je USBPcap-Root-Hub auflisten
          cameradraw-buttons parse <datei>       Tastenpakete in einer USBPcap-Aufzeichnung (.pcap) suchen
          cameradraw-buttons brightness v:p [ms] UVC-Helligkeit lesen und Änderungen als JSON ausgeben,
                                                 bis stdin endet (Standard alle 65 ms, ohne Admin)
          cameradraw-buttons powerline v:p [n]   Flimmerfilter lesen bzw. setzen (0 aus, 1 50 Hz,
                                                 2 60 Hz) und als JSON ausgeben (ohne Admin)
        """);
    return 1;
}
