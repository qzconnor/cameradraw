// Builds the "CameraDraw Buttons" Windows service (service/) as a single NativeAOT executable in
// service/publish/. Needs the .NET SDK and the Visual Studio C++ build tools.
import { execFileSync } from 'child_process'
import { join } from 'path'

if (process.platform !== 'win32') {
  console.log('build:service: only on Windows – skipped.')
  process.exit(0)
}

// The NativeAOT linker setup calls vswhere.exe, which is not on PATH by default.
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH'
const installer = join(
  process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer'
)

execFileSync(
  'dotnet',
  [
    'publish',
    'service/CameraDrawButtons.csproj',
    '-c',
    'Release',
    '-o',
    'service/publish',
    '-nologo'
  ],
  { stdio: 'inherit', env: { ...process.env, [pathKey]: `${installer};${process.env[pathKey]}` } }
)
