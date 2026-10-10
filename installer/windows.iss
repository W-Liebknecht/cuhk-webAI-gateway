#ifndef PayloadDir
  #error PayloadDir must point to the prepared installer payload
#endif
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{1DCE581A-36D4-4CB7-954A-DB60F9224233}
AppName=CUHK AI Bridge
AppVersion={#AppVersion}
AppPublisher=CUHK AI Bridge contributors
AppPublisherURL=https://github.com/hfp556/cuhk-ai-codex-bridge
AppSupportURL=https://github.com/hfp556/cuhk-ai-codex-bridge/issues
AppUpdatesURL=https://github.com/hfp556/cuhk-ai-codex-bridge/releases
DefaultDirName={localappdata}\Programs\CUHK AI Bridge
DefaultGroupName=CUHK AI Bridge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
UsePreviousAppDir=yes
OutputBaseFilename=CUHK-AI-Bridge-Setup-{#AppVersion}-win-x64
OutputDir=..\dist
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
MinVersion=10.0
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64compatible
LicenseFile=..\LICENSE
UninstallDisplayIcon={app}\app\CUHK-AI-Settings.exe
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "chinesesimp"; MessagesFile: "ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："

[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\CUHK AI Bridge"; Filename: "{app}\app\CUHK-AI-Settings.exe"; WorkingDir: "{app}"
Name: "{group}\首次使用说明"; Filename: "{app}\docs\first-run.html"
Name: "{group}\打开 Chrome 扩展文件夹"; Filename: "{sys}\explorer.exe"; Parameters: """{app}\.dependencies\opencli\extension"""
Name: "{group}\卸载 CUHK AI Bridge"; Filename: "{uninstallexe}"
Name: "{autodesktop}\CUHK AI Bridge"; Filename: "{app}\app\CUHK-AI-Settings.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{app}\docs\first-run.html"; Description: "查看首次使用说明"; Flags: postinstall shellexec skipifsilent
Filename: "{app}\app\CUHK-AI-Settings.exe"; Description: "启动 CUHK AI Bridge"; Flags: postinstall nowait skipifsilent unchecked

[UninstallRun]
Filename: "{app}\runtime\node.exe"; Parameters: """{app}\bin\cuhk-gateway.cjs"" stop"; Flags: runhidden; RunOnceId: "StopLocalGateway"
