using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Diagnostics;
using System.ComponentModel;
using System.Runtime.InteropServices;

// The job handle is never inherited. Killing this transport process closes the
// last handle and terminates its entire job, including detached grandchildren.
public static class McpJob {
    const uint Suspended = 4, NoWindow = 0x08000000, KillOnClose = 0x2000;
    const uint QueryProcess = 0x1000, QueryJob = 4, TerminateJob = 8, Infinite = 0xffffffff;
    [StructLayout(LayoutKind.Sequential)] struct Limits {
        public long processTime, jobTime;
        public uint flags;
        public UIntPtr minWorking, maxWorking;
        public uint activeLimit;
        public UIntPtr affinity;
        public uint priority, scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a, b, c, d, e, f; }
    [StructLayout(LayoutKind.Sequential)] struct Extended {
        public Limits basic;
        public Io io;
        public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public uint size;
        public string reserved, desktop, title;
        public uint x, y, width, height, charsX, charsY, fill, flags;
        public ushort show, reservedSize;
        public IntPtr reservedPtr, stdin, stdout, stderr;
    }
    [StructLayout(LayoutKind.Sequential)] struct Child { public IntPtr process, thread; public uint pid, tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr OpenJobObjectW(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int info, ref Extended limits, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int info, IntPtr data, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcessW(string app, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref Startup startup, out Child child);
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
    [DllImport("kernel32.dll")] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr process, uint flags, StringBuilder name, ref uint size);
    [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table, ref uint size, bool sort, uint family, uint type, uint reserved);

    static string Quote(string value) {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value) {
            if (c == '\\') { slashes++; continue; }
            result.Append('\\', c == '"' ? slashes * 2 + 1 : slashes);
            result.Append(c); slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }
    static string EscapeCmd(string value) {
        var result = new StringBuilder();
        foreach (char c in value) { if ("()[]%!^\"`<>&|;, *?".IndexOf(c) >= 0) result.Append('^'); result.Append(c); }
        return result.ToString();
    }
    static string Resolve(string command) {
        var extensions = Path.HasExtension(command) ? new[] { "" } :
            (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").Split(';').Concat(new[] { "" });
        var directories = Path.IsPathRooted(command) ? new[] { "" } : new[] { Environment.CurrentDirectory }.Concat((Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'));
        foreach (string directory in directories) foreach (string ext in extensions) {
            string candidate = Path.Combine(directory.Trim('"'), command + ext);
            if (File.Exists(candidate)) return Path.GetFullPath(candidate);
        }
        throw new Win32Exception(2);
    }
    static bool Alive(string[] state) {
        int pid; long birth;
        if (state.Length != 3 || !int.TryParse(state[0], out pid) || !long.TryParse(state[1], out birth)) throw new IOException("Invalid state");
        try { using (var process = Process.GetProcessById(pid)) return process.StartTime.ToUniversalTime().ToFileTimeUtc() == birth && !process.HasExited; }
        catch (ArgumentException) { return false; }
    }
    static string Ports(string directory) {
        bool found = false;
        var members = new HashSet<uint>();
        if (!Directory.Exists(directory)) throw new IOException("Missing state");
        foreach (string file in Directory.GetFiles(directory, "*.state")) {
            var state = File.ReadAllLines(file);
            if (!Alive(state)) { File.Delete(file); continue; }
            found = true;
            IntPtr job = OpenJobObjectW(QueryJob, false, state[2]);
            if (job == IntPtr.Zero) throw new Win32Exception();
            IntPtr buffer = Marshal.AllocHGlobal(8 + 256 * IntPtr.Size);
            try {
                if (!QueryInformationJobObject(job, 3, buffer, (uint)(8 + 256 * IntPtr.Size), IntPtr.Zero)) throw new Win32Exception();
                int count = Marshal.ReadInt32(buffer, 4);
                for (int i = 0; i < count; i++) {
                    uint pid = (uint)Marshal.ReadIntPtr(buffer, 8 + i * IntPtr.Size).ToInt64();
                    members.Add(pid);
                }
            } finally { Marshal.FreeHGlobal(buffer); CloseHandle(job); }
        }
        if (!found) throw new IOException("No live connection");
        var ports = new HashSet<int>();
        foreach (uint family in new uint[] { 2, 23 }) {
            uint size = 0;
            GetExtendedTcpTable(IntPtr.Zero, ref size, false, family, 3, 0);
            IntPtr table = Marshal.AllocHGlobal((int)size);
            try {
                if (GetExtendedTcpTable(table, ref size, false, family, 3, 0) != 0) throw new IOException("TCP snapshot failed");
                int count = Marshal.ReadInt32(table), stride = family == 2 ? 24 : 56;
                for (int i = 0; i < count; i++) {
                    int offset = 4 + i * stride;
                    uint pid = (uint)Marshal.ReadInt32(table, offset + (family == 2 ? 20 : 52));
                    if (!members.Contains(pid)) continue;
                    int port = Marshal.ReadInt32(table, offset + (family == 2 ? 8 : 20));
                    ports.Add(((port & 255) << 8) | ((port >> 8) & 255));
                }
            } finally { Marshal.FreeHGlobal(table); }
        }
        return "[" + String.Join(",", ports) + "]";
    }
    public static int Main(string[] args) {
        try {
            if (args.Length == 2 && args[0] == "--release") {
                if (!Directory.Exists(args[1])) return 0;
                foreach (string file in Directory.GetFiles(args[1], "*.state")) {
                    if (!File.Exists(file)) continue;
                    var state = File.ReadAllLines(file);
                    if (!Alive(state)) continue;
                    string expected = "Local\\OpenChamberMcp-" + state[0] + "-" + state[1];
                    if (state[2] != expected) throw new IOException("Invalid job identity");
                    IntPtr releaseJob = OpenJobObjectW(TerminateJob, false, expected);
                    if (releaseJob == IntPtr.Zero) { if (!Alive(state)) continue; throw new Win32Exception(); }
                    try { if (!TerminateJobObject(releaseJob, 0)) throw new Win32Exception(); }
                    finally { CloseHandle(releaseJob); }
                }
                return 0;
            }
            if (args.Length == 2 && args[0] == "--alive") {
                bool alive = Directory.Exists(args[1]) && Directory.GetFiles(args[1], "*.state").Any(file => Alive(File.ReadAllLines(file)));
                Console.WriteLine(alive ? "alive" : "closed"); return 0;
            }
            if (args.Length == 2 && args[0] == "--ports") { Console.WriteLine(Ports(args[1])); return 0; }
            if (args.Length < 2) return 64;
            string stateDir = args[0], executable = Resolve(args[1]);
            var values = args.Skip(2).ToArray();
            string extension = Path.GetExtension(executable).ToLowerInvariant();
            string command;
            if (extension == ".cmd" || extension == ".bat") {
                bool twice = executable.IndexOf("\\node_modules\\.bin\\", StringComparison.OrdinalIgnoreCase) >= 0;
                command = EscapeCmd(executable) + " " + String.Join(" ", values.Select(value => twice ? EscapeCmd(EscapeCmd(Quote(value))) : EscapeCmd(Quote(value))));
                executable = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "cmd.exe");
                command = Quote(executable) + " /d /s /c \"" + command + "\"";
            } else { command = Quote(executable) + " " + String.Join(" ", values.Select(Quote)); }
            var self = Process.GetCurrentProcess();
            string birth = self.StartTime.ToUniversalTime().ToFileTimeUtc().ToString();
            string jobName = "Local\\OpenChamberMcp-" + self.Id + "-" + birth;
            IntPtr job = CreateJobObjectW(IntPtr.Zero, jobName);
            if (job == IntPtr.Zero) throw new Win32Exception();
            Child child = new Child(); string stateFile = null;
            try {
                var limits = new Extended(); limits.basic.flags = KillOnClose;
                if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Extended)))) throw new Win32Exception();
                var startup = new Startup { size = (uint)Marshal.SizeOf(typeof(Startup)), flags = 0x100,
                    stdin = GetStdHandle(-10), stdout = GetStdHandle(-11), stderr = GetStdHandle(-12) };
                foreach (var handle in new[] { startup.stdin, startup.stdout, startup.stderr }) SetHandleInformation(handle, 1, 1);
                if (!CreateProcessW(executable, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true, Suspended | NoWindow, IntPtr.Zero, null, ref startup, out child)) throw new Win32Exception();
                if (!AssignProcessToJobObject(job, child.process)) { TerminateProcess(child.process, 1); throw new Win32Exception(); }
                Directory.CreateDirectory(stateDir);
                foreach (string file in Directory.GetFiles(stateDir, "*.state")) { try { if (!Alive(File.ReadAllLines(file))) File.Delete(file); } catch { } }
                stateFile = Path.Combine(stateDir, self.Id + "-" + birth + ".state");
                File.WriteAllLines(stateFile, new[] { self.Id.ToString(), birth, jobName });
                if (ResumeThread(child.thread) == Infinite) { TerminateProcess(child.process, 1); throw new Win32Exception(); }
                WaitForSingleObject(child.process, Infinite);
                uint code; if (!GetExitCodeProcess(child.process, out code)) throw new Win32Exception();
                return (int)code;
            } finally {
                CloseHandle(job);
                if (child.thread != IntPtr.Zero) CloseHandle(child.thread);
                if (child.process != IntPtr.Zero) CloseHandle(child.process);
                if (stateFile != null) { try { File.Delete(stateFile); } catch { } }
            }
        } catch (Exception error) {
            var native = error as Win32Exception;
            Console.Error.WriteLine("[mcp-job] failed code=" + (native == null ? 1 : native.NativeErrorCode));
            return 1;
        }
    }
}
