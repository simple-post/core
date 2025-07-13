import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { join } from "path";

async function runAllExamples() {
  const examplesDir = join(import.meta.dirname, "..");
  const folders = readdirSync(examplesDir).filter((item) => {
    const itemPath = join(examplesDir, item);
    return statSync(itemPath).isDirectory() && item !== "all" && item !== "assets";
  });

  for (const folder of folders) {
    const folderPath = join(examplesDir, folder);
    const tsFiles = readdirSync(folderPath).filter((file) => file.endsWith(".ts"));

    console.log(`\n${"=".repeat(50)}`);
    console.log(`${folder.toUpperCase()} (${tsFiles.length} files)`);
    console.log(`${"=".repeat(50)}\n`);

    for (const file of tsFiles) {
      const scriptPath = join(folder, file);
      console.log(scriptPath);

      try {
        execSync(`tsx ${scriptPath}`, {
          cwd: examplesDir,
          stdio: "inherit",
        });
      } catch (error) {
        // Silent error handling
      }
    }
  }
}

runAllExamples().catch(console.error);
