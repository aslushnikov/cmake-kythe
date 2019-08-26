# CMake-Kythe

This script helps running [Kythe](https://kythe.io) pipeline for cmake-compiled projects.
Main goal is to run Kythe against WebKit source.

### Example

Let's build index for a sample cmake project: [bast/cmake-example](https://github.com/bast/cmake-example).

1. First things first - clone [cmake-kythe](https://github.com/aslushnikov/cmake-kythe) and install dependencies.

```sh
user:~$ git clone https://github.com/aslushnikov/cmake-kythe
user:~$ cd cmake-kythe
user:~/cmake-kythe$ npm i
user:~/cmake-kythe$ cd ..
user:~$
```

`cmake-kythe` has a few NPM dependencies so it should be pretty quick.

2. Second - let's clone our sample cmake project [bast/cmake-example](https://github.com/bast/cmake-example).

```sh
user:~$ git clone https://github.com/bast/cmake-example
user:~$ cd cmake-example
user:~/cmake-example$
```

3. CMake-Kythe relies on [compilation database](https://clang.llvm.org/docs/JSONCompilationDatabase.html)
to produce its indexes. Thus a cmake project has to be configured first to export CMake compilation database.
This is done with a [`-DCMAKE_EXPORT_COMPILE_COMMANDS`](https://cmake.org/cmake/help/v3.5/variable/CMAKE_EXPORT_COMPILE_COMMANDS.html) flag.

Build `cmake-example`, generating compilation database:

```sh
user:~/cmake-example$ cmake -H. -Bbuild -DCMAKE_EXPORT_COMPILE_COMMANDS=1
```

This command should produce a `~/cmake-example/build` directory, with a compilation database under `~/cmake-example/build/compile_commands.json`.

> **NOTE**: if this steps throw an error for you, make sure that there's C++ compiler available on your system.
> Also, `cmake-example` wants to have Fortran available on your system. This can be avoided by removing "Fortran" from the list of
> supported langauges in `//CMakeLists.txt`.

4. Let's actually compile the `cmake-example` so that it produces all the intermediate generated files.

```sh
user:~/cmake-example$ cd build
user:~/cmake-example/build$ cmake --build .
```

This should succeed.

5. Now, we need to install Kythe separately to the system. `cmake-kythe` is tested to work well with Kythe v0.0.30, so I'd recommend
downloading [Kythe v0.0.30](https://github.com/kythe/kythe/releases/tag/v0.0.30) and extracting it into `/opt/kythe` on your system.

You should end up with `/opt/kythe` directory that has various subdirectories, e.g. `/opt/kythe/tools`, `/opt/kythe/indexers` and so on.

6. `cmake-kythe` requires a small config for it to deal with the project.

Save the following to the `~/cmake-example/config.json`:

```js
{
  // Path to Kythe installation.
  "kythe_path": "/opt/kythe",
  // This is the port to serve Kythe basic UI. Drop "localhost" if you want server to be reachable
  // from outside.
  "kythe_web_ui_port": "localhost:8080",
  // Parallelization level.
  "parallel": 1,
  // Project directory. Relative paths are resolved wrt config's location.
  "project_directory": ".",
  // Path to cmake's compilation database.
  "cmake_compilation_database": "./build/compile_commands.json",
  // Where to put index.
  "output_directory": "/tmp/cmake-example"
}
```

7. Last step - run indexing!

```sh
user:~/cmake-example$ node ../cmake-kythe/index.js config.json
```

This step takes ~5 minutes for me. Please, give it some time. Once it's done,
basic Kythe UI will be served at `localhost:8080`.
