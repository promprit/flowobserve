on open location theURL
  set py to "/usr/bin/python3"
  set script_ to (POSIX path of (path to me)) & "Contents/Resources/fo_open.py"
  do shell script quoted form of py & " -I " & quoted form of script_ & " " & quoted form of theURL & " >/dev/null 2>&1 &"
end open location
