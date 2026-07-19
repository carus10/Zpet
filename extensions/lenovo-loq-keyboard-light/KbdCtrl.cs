using System;
using System.Reflection;
using System.IO;
using System.Collections.Generic;

class KbdCtrl {
    static object agent;
    static MethodInfo setStatusMethod;
    static Type reqType, listType, settingType, listItemsType;

    static string FindDllDir() {
        string base_ = @"C:\ProgramData\Lenovo\Vantage\Addins\IdeaNotebookAddin";
        if (!Directory.Exists(base_)) return null;
        string[] dirs = Directory.GetDirectories(base_);
        if (dirs.Length == 0) return null;
        Array.Sort(dirs);
        return dirs[dirs.Length - 1];
    }

    static bool Init(string dllDir) {
        Assembly kbAsm = Assembly.LoadFrom(Path.Combine(dllDir, "KeyboardContract.dll"));
        Assembly.LoadFrom(Path.Combine(dllDir, "Newtonsoft.Json.dll"));
        Assembly asm   = Assembly.LoadFrom(Path.Combine(dllDir, "IdeaNotebookAddin.dll"));
        Type agentType = asm.GetType("IdeaNotebookAddin.IdeaNotebookAgent");
        if (agentType == null) { Console.Error.WriteLine("ERR: agentType null"); return false; }
        agent = agentType.GetMethod("GetInstance",
            BindingFlags.Public | BindingFlags.Static).Invoke(null, null);
        if (agent == null) { Console.Error.WriteLine("ERR: agent null"); return false; }
        foreach (var m in agentType.GetMethods())
            if (m.Name == "SetBacklightStatus" && m.GetParameters().Length == 1)
                setStatusMethod = m;
        if (setStatusMethod == null) { Console.Error.WriteLine("ERR: setStatusMethod null"); return false; }
        reqType       = kbAsm.GetType("Lenovo.Modern.Contracts.Keyboard.KeyboardSettingsRequest");
        listType      = kbAsm.GetType("Lenovo.Modern.Contracts.Keyboard.SettingList");
        settingType   = kbAsm.GetType("Lenovo.Modern.Contracts.Keyboard.Setting");
        listItemsType = typeof(List<>).MakeGenericType(settingType);
        return true;
    }

    static void SetLevel(string level) {
        object setting = Activator.CreateInstance(settingType);
        settingType.GetProperty("key").SetValue(setting, "KeyboardBacklightStatus", null);
        settingType.GetProperty("value").SetValue(setting, level, null);
        object items = Activator.CreateInstance(listItemsType);
        listItemsType.GetMethod("Add").Invoke(items, new[] { setting });
        object sl = Activator.CreateInstance(listType);
        listType.GetProperty("Items").SetValue(sl, items, null);
        object req = Activator.CreateInstance(reqType);
        reqType.GetProperty("List").SetValue(req, sl, null);
        setStatusMethod.Invoke(agent, new[] { req });
    }

    static void Main(string[] args) {
        // Usage:
        //   KbdCtrl.exe <dllDir> set <level>
        //   KbdCtrl.exe <dllDir> blink <count> <onMs> <offMs> <finalLevel>
        //   KbdCtrl.exe <dllDir> <level>   (legacy: Level_2 | Level_1 | Off)
        if (args.Length < 2) { Console.Error.WriteLine("Usage: KbdCtrl <dllDir> <cmd> [args]"); return; }
        string dllDir = args[0];
        string cmd    = args[1];
        try {
            if (!Init(dllDir)) return;
        } catch (Exception ex) {
            Console.Error.WriteLine("INIT ERR: " + ex.Message);
            if (ex.InnerException != null) Console.Error.WriteLine(" -> " + ex.InnerException.Message);
            return;
        }
        try {
            if (cmd == "blink") {
                int    count      = args.Length > 2 ? int.Parse(args[2])    : 3;
                int    onMs       = args.Length > 3 ? int.Parse(args[3])    : 250;
                int    offMs      = args.Length > 4 ? int.Parse(args[4])    : 200;
                string finalLevel = args.Length > 5 ? args[5]               : "Level_1";
                for (int i = 0; i < count; i++) {
                    SetLevel("Level_2");
                    System.Threading.Thread.Sleep(onMs);
                    SetLevel("Off");
                    System.Threading.Thread.Sleep(offMs);
                }
                SetLevel(finalLevel);
            } else if (cmd == "set") {
                string level = args.Length > 2 ? args[2] : "Level_1";
                SetLevel(level);
            } else {
                // Legacy: KbdCtrl.exe <dllDir> <level>
                SetLevel(cmd);
            }
            Console.WriteLine("OK:" + cmd);
        } catch (Exception ex) {
            Console.Error.WriteLine("SET ERR: " + ex.Message);
            if (ex.InnerException != null) Console.Error.WriteLine(" -> " + ex.InnerException.Message);
        }
    }
}
