// Copyright 2019 Sebastian Wiesner <sebastian@swsnr.de>

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const Gio = imports.gi.Gio;
const St = imports.gi.St;

const Main = imports.ui.main;
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const Self = imports.misc.extensionUtils.getCurrentExtension()!;

/**
 * Log a message from this extension, with prefix.
 *
 * @param message The message to log
 */
const l = (message: string): void => log(`${Self.metadata.name}: ${message}`);

/**
 * Spawn command.
 *
 * Taken from <https://github.com/andyholmes/andyholmes.github.io/blob/master/articles/asynchronous-programming-in-gjs.md#spawning-processes>
 */
const execCommand = (argv: ReadonlyArray<string>): Promise<string> =>
  new Promise((resolve, reject) => {
    // There is also a reusable Gio.SubprocessLauncher class available
    const proc = new Gio.Subprocess({
      argv: argv,
      // There are also other types of flags for merging stdout/stderr,
      // redirecting to /dev/null or inheriting the parent's pipes
      flags: Gio.SubprocessFlags.STDOUT_PIPE
    });

    // Classes that implement GInitable must be initialized before use, but
    // an alternative in this case is to use Gio.Subprocess.new(argv, flags)
    //
    // If the class implements GAsyncInitable then Class.new_async() could
    // also be used and awaited in a Promise.
    proc.init(null);

    // communicate_utf8() returns a string, communicate() returns a
    // a GLib.Bytes and there are "headless" functions available as well
    proc.communicate_utf8_async(null, null, (proc, res) => {
      try {
        resolve(proc.communicate_utf8_finish(res)[1]);
      } catch (e) {
        reject(e);
      }
    });
  });

/**
 * Find the Rider App.
 *
 * Currently only supports Rider Ultimate installed from Snap Store.
 */
const findRider = (): imports.gi.Gio.DesktopAppInfo | null => {
  const candidates = [
    // Arch Linux AUR package
    "jetbrains-rider.desktop",
    // Snap installation
    "rider.desktop",
    // Flatpak installation - this is just a guess of what it could be...
    "com.jetbrains.IntelliJ-Rider.desktop"
  ];
  for (const desktopId of candidates) {
    const app = Gio.DesktopAppInfo.new(desktopId);
    if (app) {
      l(`Found IntelliJ Rider at ${desktopId}`);
      return app;
    }
  }
  return null;
};

interface Solution {
  /**
   * The solution identifier.
   */
  readonly id: string;

  /**
   * The solution name.
   */
  readonly name: string;

  /**
   * The readable path, e.g. ~ instead of /home/…
   */
  readonly path: string;

  /**
   * The absolute path to the solution.
   */
  readonly abspath: string;
}

type SolutionMap = Map<string, Solution>;

/**
 * Lookup solutions by their identifiers.
 *
 * @param solutions Known solutions
 * @param identifiers Identifiers to look for
 * @returns All solutions from `solutions` with any of the given `identifiers`.
 */
const lookupSolutions = (
  solutions: SolutionMap,
  identifiers: ReadonlyArray<string>
): Solution[] => {
    return identifiers.map(i => {
        return solutions.get(i);
    }).filter((p): p is Solution => !!p);
}

/**
 * Whether the solution matches all terms.
 *
 * Check whether the solution matches all terms, by checking each term against
 * the solution name and the readable solution path.
 *
 * @param {Solution} solution A solution
 * @param {[string]} terms A list of search terms
 * @returns true if the solution matches, false otherwise.
 */
const solutionMatchesAllTerms = (
  solution: Solution,
  terms: ReadonlyArray<string>
): boolean =>
  terms.every(
    term => solution.name.includes(term) || solution.path.includes(term)
  );

/**
 * Find all solutions from the given list of solutions which match the terms.
 *
 * @param {[Solution]} solutions A list of solution
 * @param {[string]} terms A list of search terms
 * @returns A list of IDs of all solutions out of `solutions` which match `terms`.
 */
const findMatchingIds = (
  solutions: ReadonlyArray<Solution>,
  terms: ReadonlyArray<string>
): string[] =>
  solutions.filter(p => solutionMatchesAllTerms(p, terms)).map(p => p.id);

/**
 * Launch Rider or show an error notification on failure.
 *
 * @param rider Desktop App Info for Rider
 * @param files Files to launch Rider with
 */
const launchRiderInShell = (
  rider: imports.gi.Gio.DesktopAppInfo,
  files?: imports.gi.Gio.File[]
): void => {
  try {
    rider.launch(files || [], null);
  } catch (err) {
    imports.ui.main.notifyError("Failed to launch IntelliJ Rider", err.message);
  }
};

/**
 * Create result meta info for a solution.
 *
 * @param rider The Rider app info
 * @returns A function with creates result metadata for a given solution.
 */
const resultMetaForSolution = (rider: imports.gi.Gio.DesktopAppInfo) => (
  solution: Solution
): ResultMeta => ({
  id: solution.id,
  name: solution.name,
  description: solution.path,
  createIcon: (size): imports.gi.St.Icon | null => {
    const gicon = rider.get_icon();
    if (gicon) {
      return new St.Icon({
        gicon,
        // eslint-disable-next-line @typescript-eslint/camelcase
        icon_size: size
      });
    } else {
      return null;
    }
  }
});

/**
 * Create a search provider for Rider solutions.
 *
 * The solution exposes the given solutions for search.  On activation it uses the
 * given Rider app to open solutions.
 *
 * On search provider activation, that is, when the user clicks on the search
 * provider icon to resume search in the app, it merely opens Rider without any
 * solutions, since Rider doesn't provide an interface start a recent solutions
 * search within Rider.
 *
 * @param solutions The solution to search in
 * @param rider The IntelliJ Rider application info
 */
const createProvider = (
  solutions: SolutionMap,
  rider: imports.gi.Gio.DesktopAppInfo
): SearchProvider => ({
  id: Self.uuid,
  isRemoteProvider: false,
  canLaunchSearch: true,
  appInfo: rider,
  getInitialResultSet: (terms, callback): void =>
    callback(findMatchingIds([...solutions.values()], terms)),
  getSubsearchResultSet: (current, terms, callback): void =>
    callback(findMatchingIds(lookupSolutions(solutions, current), terms)),
  getResultMetas: (ids, callback): void =>
    callback(lookupSolutions(solutions, ids).map(resultMetaForSolution(rider))),
  launchSearch: (): void => launchRiderInShell(rider),
  activateResult: (id: string): void => {
    const solution = solutions.get(id);
    if (solution) {
      launchRiderInShell(rider, [Gio.File.new_for_path(solution.abspath)]);
    }
  },
  filterResults: (results, max): string[] => results.slice(0, max)
});

/**
 * Find all recent solutions.
 *
 * @param extensionDirectory The directory of this extension
 * @returns A promise with all recent Rider solutions.
 */
const recentSolutions = (
  extensionDirectory: imports.gi.Gio.File
): Promise<SolutionMap> => {
  const helper = extensionDirectory.get_child("find-solutions.py").get_path();
  if (!helper) {
    return Promise.reject(new Error("Helper find-solutions.py doesn't exist!"));
  } else {
    l(`Running Python helper ${helper} to discover IntelliJ Rider solutions`);
    return execCommand(["python3", helper]).then(output => {
        const json = JSON.parse(output);
        const entries = Object.entries(json);
        var solutions = new Map<string, Solution>();

        for ( const [ id, sol ] of entries ) {
            solutions.set(id, <Solution>sol);
        }

        return solutions;
    });
  }
};

type RegisteredProvider = "unregistered" | "registering" | SearchProvider;

/**
 * Initialize this extension immediately after loading.
 *
 * Doesn't do anything for this extension.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-function,@typescript-eslint/no-unused-vars
function init(): ExtensionState {
  // eslint-disable-next-line immutable/no-let
  let registeredProvider: RegisteredProvider = "unregistered";

  l("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  return {
    enable: (): void => {
      if (registeredProvider === "unregistered") {
        l(`enabling version ${Self.metadata.version}`);
        const rider = findRider();
        if (rider) {
          registeredProvider = "registering";
          recentSolutions(Self.dir).then(
            solutions => {
              if (registeredProvider === "registering") {
                // If the user hasn't disabled the extension meanwhile create the
                // search provider and registered it, both in our global variable
                // and for gnome shell.
                registeredProvider = createProvider(solutions, rider);
                Main.overview.viewSelector._searchResults._registerProvider(
                  registeredProvider
                );
              }
            },
            error => {
              // If the the user hasn't disabled the extension meanwhile show an
              // error message.
              if (registeredProvider === "registering") {
                Main.notifyError(
                  "Failed to find recent solutions",
                  error.message
                );
              }
            }
          );
        } else {
          Main.notifyError(
            "IntelliJ Rider not found",
            "Consider reporting on https://github.com/seif/gnome-intellij-rider-search-provider/issues/"
          );
        }
      }
    },
    disable: (): void => {
      if (typeof registeredProvider !== "string") {
        // Remove the provider if it was registered
        l(`Disabling ${Self.metadata.version}`);
        Main.overview.viewSelector._searchResults._unregisterProvider(
          registeredProvider
        );
      }
      // In any case mark the provider as unregistered, so that we can register it
      // again when the user reenables the extension.
      registeredProvider = "unregistered";
    }
  };
}
