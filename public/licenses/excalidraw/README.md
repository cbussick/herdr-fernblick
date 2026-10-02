# Excalidraw and bundled font notices

Excalidraw is pinned to 0.18.1. `npm run prepare:whiteboard` copies its unmodified font files from the installed package to `/excalidraw/fonts/`; the files are generated, not separately versioned. These notices ship at `/licenses/excalidraw/`.

Sources inspected for redistribution notices:

- Excalidraw: https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/LICENSE
- Assistant: https://raw.githubusercontent.com/google/fonts/main/ofl/assistant/OFL.txt
- Cascadia: https://raw.githubusercontent.com/microsoft/cascadia-code/main/LICENSE
- ComicShanns: https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/ComicShanns/index.ts
- Excalifont: https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/Excalifont/index.ts
- Liberation: https://raw.githubusercontent.com/liberationfonts/liberation-fonts/main/LICENSE
- Lilita: https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt
- Nunito: https://raw.githubusercontent.com/google/fonts/main/ofl/nunito/OFL.txt
- Virgil: https://raw.githubusercontent.com/excalidraw/virgil/main/LICENSE.md
- Xiaolai: https://raw.githubusercontent.com/excalidraw/excalidraw/v0.18.1/packages/excalidraw/fonts/Xiaolai/index.ts

Excalifont, Comic Shanns and Xiaolai notices include the font metadata reproduced in Excalidraw's tagged source. Xiaolai's metadata references OFL 1.1; the complete OFL text is included alongside it. Other font notices are from their respective upstream projects. Font files are not renamed or modified. The SDK is MIT; fonts retain their own MIT or SIL OFL licenses.
