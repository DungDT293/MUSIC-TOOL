Add-Type @"
using System;
using System.Runtime.InteropServices;

public class DesktopDevLauncher {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct STARTUPINFO {
        public Int32 cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public Int32 dwX;
        public Int32 dwY;
        public Int32 dwXSize;
        public Int32 dwYSize;
        public Int32 dwXCountChars;
        public Int32 dwYCountChars;
        public Int32 dwFillAttribute;
        public Int32 dwFlags;
        public Int16 wShowWindow;
        public Int16 cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public Int32 dwProcessId;
        public Int32 dwThreadId;
    }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcess(
        string lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation
    );

    [DllImport("kernel32.dll")]
    public static extern uint GetLastError();

    [DllImport("kernel32.dll")]
    public static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern UInt32 WaitForSingleObject(IntPtr hHandle, UInt32 dwMilliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);

    public static void Run(string commandLine, string workingDir) {
        STARTUPINFO si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(si);
        si.lpDesktop = @"winsta0\default";
        si.dwFlags = 0x00000100; // STARTF_USESTDHANDLES
        si.hStdInput = GetStdHandle(-10);
        si.hStdOutput = GetStdHandle(-11);
        si.hStdError = GetStdHandle(-12);

        PROCESS_INFORMATION pi = new PROCESS_INFORMATION();

        Console.WriteLine("[Launcher] Spawning process on winsta0\\default: " + commandLine);
        bool success = CreateProcess(
            null,
            commandLine,
            IntPtr.Zero,
            IntPtr.Zero,
            true, // bInheritHandles
            0,
            IntPtr.Zero,
            workingDir,
            ref si,
            out pi
        );

        if (!success) {
            Console.WriteLine("[Launcher] CreateProcess failed with error code: " + GetLastError());
            return;
        }

        Console.WriteLine("[Launcher] Successfully spawned on winsta0\\default! PID: " + pi.dwProcessId);
        CloseHandle(pi.hThread);

        // Wait indefinitely until the dev server process exits
        WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
        CloseHandle(pi.hProcess);
        Console.WriteLine("[Launcher] Child process terminated.");
    }
}
"@

$cmd = "cmd.exe /c npm run dev"
$workingDir = "E:\TOOL DUNG CODE\93-media-tool-mix-nhac"
[DesktopDevLauncher]::Run($cmd, $workingDir)

