// Embedded so the same reader works in the web package and bundled Electron.
// Toolhelp discovers topology; handles read metrics only for the managed tree.
const windowsProcessSource = String.raw`
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class OpenChamberProcesses {
    const uint SnapshotProcesses = 2, QueryInformation = 0x1000;
    const int NoMoreFiles = 18, InvalidParameter = 87;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Entry {
        public uint size, usage, pid;
        public UIntPtr heap;
        public uint module, threads, parent;
        public int priority;
        public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string name;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct Times { public uint low, high; public ulong Value { get { return ((ulong)high << 32) | low; } } }
    [StructLayout(LayoutKind.Sequential)]
    struct Memory {
        public uint size, faults;
        public UIntPtr peak, working, quotaPeakPaged, quotaPaged, quotaPeakNonpaged, quotaNonpaged, pagefile, peakPagefile, privateBytes;
    }
    public sealed class Row {
        public uint pid, parent;
        public string name, birth;
        public double memory, cpu;
        public double peakWorkingSet, privateBytes, pagefileBytes, peakPagefileBytes, pageFaults, kernelSeconds, userSeconds;
    }
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr snapshot, ref Entry entry);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out Times birth, out Times exit, out Times kernel, out Times user);
    [DllImport("psapi.dll", SetLastError = true)] static extern bool GetProcessMemoryInfo(IntPtr process, ref Memory memory, uint size);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static Exception Failure(string stage, uint pid) {
        int code = Marshal.GetLastWin32Error();
        return new Win32Exception(code, "OC_PERF|" + stage + "|" + pid + "|" + code);
    }

    public static Row[] Read(uint root, uint[] tracked, uint excluded) {
        var entries = new Dictionary<uint, Entry>();
        IntPtr snapshot = CreateToolhelp32Snapshot(SnapshotProcesses, 0);
        if (snapshot == new IntPtr(-1)) throw Failure("snapshot", root);
        try {
            var entry = new Entry { size = (uint)Marshal.SizeOf(typeof(Entry)) };
            if (!Process32FirstW(snapshot, ref entry)) throw Failure("first", root);
            do { entries[entry.pid] = entry; } while (Process32NextW(snapshot, ref entry));
            if (Marshal.GetLastWin32Error() != NoMoreFiles) throw Failure("next", root);
        } finally { CloseHandle(snapshot); }
        var children = new Dictionary<uint, List<uint>>();
        foreach (var entry in entries.Values) {
            if (!children.ContainsKey(entry.parent)) children[entry.parent] = new List<uint>();
            children[entry.parent].Add(entry.pid);
        }
        var selected = new HashSet<uint>(tracked);
        selected.Add(root);
        var queue = new Queue<uint>(selected);
        while (queue.Count > 0) {
            uint pid = queue.Dequeue();
            if (!children.ContainsKey(pid)) continue;
            foreach (uint child in children[pid]) {
                if (child != excluded && selected.Add(child)) queue.Enqueue(child);
            }
        }
        var rows = new List<Row>();
        foreach (uint pid in selected) {
            if (pid == excluded || !entries.ContainsKey(pid)) continue;
            IntPtr handle = OpenProcess(QueryInformation, false, pid);
            if (handle == IntPtr.Zero) {
                if (Marshal.GetLastWin32Error() == InvalidParameter && pid != root) continue;
                throw Failure("open", pid);
            }
            try {
                Times birth, exit, kernel, user;
                if (!GetProcessTimes(handle, out birth, out exit, out kernel, out user)) throw Failure("times", pid);
                if (exit.Value != 0 && pid != root) continue;
                var memory = new Memory { size = (uint)Marshal.SizeOf(typeof(Memory)) };
                if (!GetProcessMemoryInfo(handle, ref memory, memory.size)) throw Failure("memory", pid);
                var entry = entries[pid];
                rows.Add(new Row { pid = pid, parent = entry.parent, name = entry.name,
                    birth = birth.Value.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    memory = memory.working.ToUInt64(), cpu = (kernel.Value + user.Value) / 10000000.0,
                    peakWorkingSet = memory.peak.ToUInt64(), privateBytes = memory.privateBytes.ToUInt64(),
                    pagefileBytes = memory.pagefile.ToUInt64(), peakPagefileBytes = memory.peakPagefile.ToUInt64(),
                    pageFaults = memory.faults, kernelSeconds = kernel.Value / 10000000.0, userSeconds = user.Value / 10000000.0 });
            } finally { CloseHandle(handle); }
        }
        return rows.ToArray();
    }
}
`;

export function windowsProcessQuery(root, tracked) {
  const valid = (pid) => Number.isSafeInteger(pid) && pid > 0 && pid <= 0xffffffff;
  if (!valid(root) || tracked.some((pid) => !valid(pid))) {
    throw new Error('Invalid process identity');
  }
  return `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -TypeDefinition @'
${windowsProcessSource}
'@; ConvertTo-Json -Compress -InputObject @([OpenChamberProcesses]::Read(${root}, [uint32[]]@(${tracked.join(',')}), $PID))`;
}
