import { readdir, readFile } from "node:fs/promises";
import ts from "typescript";

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = `${directory}/${entry.name}`;
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}

const errors = [];
for (const path of [...(await files("src")), ...(await files(".storybook"))]) {
  if (path.endsWith(".css") && !path.endsWith(".module.css")) {
    errors.push(`${path}: use a .module.css file`);
  }
  if (path.endsWith(".tsx")) {
    const source = await readFile(path, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (
        ts.isJsxAttribute(node) &&
        node.name.getText(ast) === "className" &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text.trim()
      ) {
        errors.push(
          `${path}: import class names from a CSS Module instead of using literal classes`,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
}
const sourceLicense = await readFile("src/styles/fonts/Manrope-LICENSE.txt", "utf8");
const shippedLicense = await readFile("public/licenses/Manrope-OFL.txt", "utf8");
if (sourceLicense !== shippedLicense)
  errors.push("The redistributed Manrope license must match the source license");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else console.log("CSS Modules conventions and redistributed font license passed");
