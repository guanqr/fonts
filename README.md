# Web Font Auto-Subsetting Workflow

Automated web font subsetting workflow with chunked loading for optimal performance.

## Supported Fonts

### Chinese Fonts

#### I.MingCP
- **Font ID**: `imingcp`
- **Type**: Traditional Chinese serif
- **Source**: [ichitenfont/I.Ming](https://github.com/ichitenfont/I.Ming)
- **License**: IPA Font License Agreement v1.0

#### LXGW WenKai TC (Light Weight Only)
- **Font ID**: `lxgwwenkaitc`
- **Type**: Traditional Chinese handwriting
- **Source**: [lxgw/LxgwWenkaiTC](https://github.com/lxgw/LxgwWenkaiTC)
- **License**: SIL Open Font License 1.1

### English Fonts

#### JetBrains Mono
- **Font ID**: `jetbrainsmono`
- **Type**: Latin monospaced font
- **Source**: [JetBrains/JetBrainsMono](https://github.com/JetBrains/JetBrainsMono)
- **License**: SIL Open Font License 1.1

### Variable Fonts

#### Amstelvar
- **Font ID**: `amstelvar`
- **Type**: Latin variable font
- **Source**: [googlefonts/amstelvar](https://github.com/googlefonts/amstelvar)
- **License**: SIL Open Font License 1.1

## Usage

### CDN

[![](https://data.jsdelivr.com/v1/package/gh/guanqr/fonts/badge)](https://www.jsdelivr.com/package/gh/guanqr/fonts) [![](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdata.jsdelivr.com%2Fv1%2Fstats%2Fpackages%2Fgh%2Fguanqr%2Ffonts%40build%2Ffiles&query=%24%5B0%5D%5B'hits'%5D%5B'total'%5D&suffix=%20hits%2Fmonth&style=flat-square&label=fonts.min.css&labelColor=555&color=ff5627)](https://data.jsdelivr.com/v1/stats/packages/gh/guanqr/fonts@build/files)

For best performance, load only the font stylesheet you use. The Chinese font stylesheets contain hundreds of `@font-face` rules (I.MingCP is currently about 253 KB and LXGW WenKai TC about 173 KB minified; all four are about 443 KB together). The unified stylesheet imports all of them.

```html
<!-- Individual fonts (recommended) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/guanqr/fonts@build/css/imingcp.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/guanqr/fonts@build/css/lxgwwenkaitc.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/guanqr/fonts@build/css/jetbrainsmono.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/guanqr/fonts@build/css/amstelvar.min.css">

<!-- All fonts (only when a page needs multiple fonts) -->
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/guanqr/fonts@build/css/fonts.min.css">
```

### CSS

```css
/* Traditional Chinese serif */
.serif { font-family: 'I.MingCP', serif; }

/* Traditional Chinese handwriting */
.handwriting { font-family: 'LXGW WenKai TC', cursive; font-weight: 300; }

/* Latin monospaced font */
.monospaced { font-family: 'JetBrains Mono', monospace; }

/* Latin variable font */
.variable { font-family: 'Amstelvar', serif; }
```

### Caching

`@build` URLs may be cached by jsDelivr and browsers for up to 7 days. Font chunks are content-hashed, so new CSS always points to new files. For immediate updates, use a commit- or release-pinned jsDelivr URL instead of `@build`.

## Development

### Setup

Requirements: Node.js 20+, pnpm, and Python 3 with pip for font editing. The edit stage creates `.venv-scripts/` and installs `fonttools` automatically.

```bash
git clone <repo-url>
cd fonts
pnpm install
```

### Downloads and proxies

Font downloads honor `HTTPS_PROXY`, `HTTP_PROXY`, `ALL_PROXY` and `NO_PROXY` environment variables. Downloads stream to a temporary file, time out, and retry transient failures with backoff.

### CLI Commands

```bash
pnpm run cli:build              # Build all fonts
pnpm run cli:build --fonts imingcp,lxgwwenkaitc  # Build specific fonts
pnpm run cli:check              # Check for updates
pnpm run cli:clean --all --force  # Clean cache and build artifacts
```

### Scripts

```bash
pnpm start                      # Full workflow with version check
pnpm run build                  # Compile TypeScript
pnpm run dev                    # Development mode with watch
pnpm run lint                   # Run ESLint
pnpm test                       # Build and run tests
```

## License

MIT License - see [LICENSE.md](LICENSE.md) for details.

Individual fonts maintain their respective licenses as documented above.

## Acknowledgements

Thanks to [KonghaYao/cn-font-split](https://github.com/KonghaYao/cn-font-split) for lightning-fast subsetting.
