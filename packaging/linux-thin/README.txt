Logtext thin Linux archive
==========================

This archive contains the native Logtext executable, README, and license. It
does not bundle the Linux desktop and WebView runtimes, so it is intended for
experienced users whose systems already provide those dependencies.

Debian and Ubuntu users should normally choose the Logtext .deb package. It
integrates with the package manager and installs declared dependencies. Choose
the AppImage when portability is more important than package-manager
integration.

Requirements
------------

- x86_64 Linux compatible with the Ubuntu 22.04 build baseline
- WebKitGTK 4.1 runtime
- GTK 3 runtime
- compatible GLib, AppIndicator, librsvg, and standard system libraries
- xdg-utils

Package names differ between Linux distributions.

Run Logtext
-----------

Extract the archive and run:

  ./Logtext

If the executable bit was lost while copying or extracting the archive, restore
it first:

  chmod +x Logtext

Limitations
-----------

- no automatic dependency installation
- no desktop file or application-menu entry
- no bundled WebView runtime
- no automatic updates
