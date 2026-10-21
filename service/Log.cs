namespace CameraDrawButtons;

/// <summary>Writes to the console, or to a small log file while running as a service.</summary>
internal static class Log
{
    private const long MaxFileSize = 256 * 1024;
    private static readonly object Lock = new();
    private static string? _file;

    /// <summary>Logs to <paramref name="path"/> from now on; starts over once the file grows too big.</summary>
    public static void UseFile(string path)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            if (File.Exists(path) && new FileInfo(path).Length > MaxFileSize) File.Delete(path);
            _file = path;
        }
        catch (IOException)
        {
            // Keep running without a log.
        }
    }

    public static void Write(string message)
    {
        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff}  {message}";
        lock (Lock)
        {
            if (_file == null)
            {
                Console.WriteLine(line);
                return;
            }
            try
            {
                File.AppendAllText(_file, line + Environment.NewLine);
            }
            catch (IOException)
            {
            }
        }
    }
}
