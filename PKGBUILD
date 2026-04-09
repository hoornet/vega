# Maintainer: hoornet <hoornet@users.noreply.github.com>
pkgname=vega-nostr
pkgver=0.12.5
pkgrel=1
pkgdesc="Cross-platform Nostr desktop client with Lightning integration"
arch=('x86_64')
url="https://github.com/hoornet/vega"
license=('MIT')
depends=(
    'webkit2gtk-4.1'
    'gtk3'
    'libayatana-appindicator'
    'openssl'
    'gst-plugins-base'
    'gst-plugins-good'
    'gst-libav'
)
makedepends=(
    'rust'
    'cargo'
    'nodejs'
    'npm'
)
source=("$pkgname-$pkgver::git+https://github.com/hoornet/vega.git#tag=v$pkgver")
sha256sums=('SKIP')

build() {
    cd "$pkgname-$pkgver"
    npm install
    npm run tauri build -- --bundles deb
}

package() {
    cd "$pkgname-$pkgver"

    install -Dm755 "src-tauri/target/release/vega" \
        "$pkgdir/usr/bin/vega"

    install -Dm644 "src-tauri/icons/128x128.png" \
        "$pkgdir/usr/share/icons/hicolor/128x128/apps/vega.png"

    install -Dm644 /dev/stdin \
        "$pkgdir/usr/share/applications/vega.desktop" << 'EOF'
[Desktop Entry]
Name=Vega
Comment=Nostr desktop client
Exec=env WEBKIT_DISABLE_DMABUF_RENDERER=1 /usr/bin/vega
Icon=vega
Type=Application
Categories=Network;InstantMessaging;
StartupNotify=true
EOF

    install -Dm644 "LICENSE" \
        "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
