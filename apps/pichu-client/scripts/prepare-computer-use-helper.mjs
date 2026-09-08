import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { chmod } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const appRoot = resolve(import.meta.dirname, '..')
const helperEntry = join(appRoot, 'out', 'main', 'tools', 'computer-use', 'helper-entry.js')
const macInputPackage = join(appRoot, '..', '..', 'packages', 'mac-input')
const generatedRoot = join(appRoot, 'build', 'generated', 'helpers')
const helperAppRoot = join(generatedRoot, 'Owls Computer Use.app')
const helperContents = join(helperAppRoot, 'Contents')
const helperMacOs = join(helperContents, 'MacOS')
const helperResources = join(helperContents, 'Resources')
const helperExecutable = join(helperMacOs, 'Owls Computer Use')
const helperLauncherSource = join(helperMacOs, 'pichu-computer-use-launcher.c')

if (!existsSync(helperEntry)) {
  throw new Error(
    `Computer Use helper entry is missing at ${helperEntry}. Run pnpm run build first.`
  )
}

if (!existsSync(join(macInputPackage, 'index.js'))) {
  throw new Error(`@pichu/mac-input package is missing at ${macInputPackage}.`)
}

rmSync(helperAppRoot, { recursive: true, force: true })
mkdirSync(helperMacOs, { recursive: true })
mkdirSync(helperResources, { recursive: true })

writeFileSync(
  join(helperContents, 'Info.plist'),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>en</string>
    <key>CFBundleDisplayName</key>
    <string>Owls Computer Use</string>
    <key>CFBundleExecutable</key>
    <string>Owls Computer Use</string>
    <key>CFBundleIdentifier</key>
    <string>us.pichuapp.pichu.computer-use</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Owls Computer Use</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSBackgroundOnly</key>
    <true/>
  </dict>
</plist>
`
)

writeFileSync(join(helperContents, 'PkgInfo'), 'APPL????')

copyFileSync(helperEntry, join(helperResources, 'helper-entry.js'))

const helperNodeModules = join(helperResources, 'node_modules', '@pichu')
mkdirSync(helperNodeModules, { recursive: true })
cpSync(macInputPackage, join(helperNodeModules, 'mac-input'), {
  recursive: true,
  dereference: true,
  filter: (source) => {
    const relative = source.slice(macInputPackage.length + 1)
    if (!relative) return true
    if (relative === 'target' || relative.startsWith('target/')) return false
    if (relative === 'src' || relative.startsWith('src/')) return false
    if (relative === 'Cargo.toml' || relative === 'Cargo.lock' || relative === 'build.rs') {
      return false
    }
    return true
  }
})

writeFileSync(
  helperLauncherSource,
  `#include <errno.h>
#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static void dirname_in_place(char *path) {
  char *slash = strrchr(path, '/');
  if (slash == NULL) {
    strcpy(path, ".");
    return;
  }
  if (slash == path) {
    slash[1] = '\\0';
    return;
  }
  *slash = '\\0';
}

int main(int argc, char **argv) {
  char executable_path[PATH_MAX];
  uint32_t executable_path_size = sizeof(executable_path);
  if (_NSGetExecutablePath(executable_path, &executable_path_size) != 0) {
    fprintf(stderr, "Owls Computer Use launcher path is too long.\\n");
    return 127;
  }

  char script_dir[PATH_MAX];
  if (realpath(executable_path, script_dir) == NULL) {
    perror("realpath");
    return 127;
  }
  dirname_in_place(script_dir);

  char node_path[PATH_MAX];
  char helper_entry[PATH_MAX];
  const char *node_subdir =
#if defined(__aarch64__) || defined(__arm64__)
      "darwin-arm64";
#else
      "darwin-x64";
#endif
  snprintf(node_path, sizeof(node_path), "%s/../../../../node/%s/bin/node", script_dir, node_subdir);
  snprintf(helper_entry, sizeof(helper_entry), "%s/../Resources/helper-entry.js", script_dir);

  char **child_argv = calloc((size_t)argc + 2, sizeof(char *));
  if (child_argv == NULL) {
    perror("calloc");
    return 127;
  }
  child_argv[0] = node_path;
  child_argv[1] = helper_entry;
  for (int i = 1; i < argc; i++) {
    child_argv[i + 1] = argv[i];
  }

  execv(node_path, child_argv);
  perror("execv");
  return errno == ENOENT ? 127 : 126;
}
`
)

execFileSync('/usr/bin/clang', [helperLauncherSource, '-Os', '-o', helperExecutable])
await chmod(helperExecutable, 0o755)
rmSync(helperLauncherSource, { force: true })

console.log(`Prepared Computer Use helper app at ${helperAppRoot}`)
