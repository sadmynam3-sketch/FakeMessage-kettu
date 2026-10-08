# FakeMessage Kettu build

This workflow converts the existing `FakeMessage/index.js` into the expression-style bundle expected by Kettu's external plugin loader and publishes the built files under `dist/FakeMessage/`.

After the GitHub Action finishes, install this folder in Kettu:

`https://raw.githubusercontent.com/sadmynam3-sketch/FakeMessage-kettu/main/dist/FakeMessage/`

The source plugin remains in `FakeMessage/`; Kettu should use only the generated `dist/FakeMessage/` folder.
