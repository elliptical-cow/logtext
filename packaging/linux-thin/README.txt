Logtext thin Linux build
========================

This archive contains the native Logtext executable without bundled Linux
desktop or WebView libraries. It is intended for experienced users whose
systems already provide the required runtime dependencies.

Requirements
------------

- x86_64 Linux compatible with the Ubuntu 22.04 build baseline
- WebKitGTK 4.1 runtime
- GTK 3 runtime
- the corresponding GLib, AppIndicator, librsvg, and standard system libraries
- xdg-utils

Package names differ between Linux distributions. Debian and Ubuntu users
should normally install the Logtext .deb package instead, as it lets the package
manager resolve the required dependencies.

Run Logtext
-----------

Extract the archive and run:

  ./Logtext

This thin archive does not install a desktop file or application-menu entry and
does not install or update system dependencies. Use the AppImage when a more
portable Linux package is preferable.
