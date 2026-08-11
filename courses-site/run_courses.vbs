'Hidden launcher for run_courses.ps1 - runs with zero visible windows.
Set sh = CreateObject("WScript.Shell")
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""C:\Users\valera333\Desktop\vork\valera-projects-master\courses-site\run_courses.ps1""", 0, True
