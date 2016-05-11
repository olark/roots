var path = require('path'),
    fs = require('fs'),
    _ = require('underscore'),
    minimatch = require('minimatch'),
    output_path = require('../utils/output_path'),
    yaml_parser = require('../utils/yaml_parser'),
    watcher = require('../watcher'),
    roots = require('../index'),
    colors = require('colors');

roots.server = require('../server');
_.bindAll(roots.print, 'reload');

var _watch = function(args){

  if (args.open == false) roots.project.open = false

  // compile once and run the local server when ready
  roots.project.mode = 'dev';
  roots.browserPrinter = new roots.printers.BrowserPrinter(); // @private
  roots.print.log("starting server...")
  roots.server.start(roots.project.path('public'));
  // TODO: consider doing this after all?
  // roots.print.log("beginning initial compile...");
  // roots.compile_project(roots.project.rootDir, function(){
  //   roots.print.log("finished initial compile!");
  //   roots.browserPrinter.start();
  // });

  // watch the project for changes and reload
  watcher.watch_directory(roots.project.rootDir, _.debounce(watch_function, 500));

  function can_retrieve_dependents_for_ignored_files() {

    if (roots.project.config_path) {
      if (require(roots.project.config_path).retrieve_dependents_for_ignored_file) {
        return true;
      }
    }
    return false;
  }

  function watch_function(file){

    // make sure the file wasn't deleted
    if (fs.existsSync(file.fullPath)){
      // if it's a dynamic file, the entire project needs to be recompiled
      // so that references to it show up in other files
      if (yaml_parser.detect(file.fullPath)) return compile_project('dynamic file');

      // ignored files that are modified are often dependencies
      // for another non-ignored file. Until we have an asset graph
      // in this project, the safest approach is to recompile the
      // whole project when an ignored file is modified.
      var ignored = roots.project.ignore_files;

      for (var i = 0; i < ignored.length; i++){
        if (minimatch(path.basename(file.path), ignored[i].slice(1))) {
          if (can_retrieve_dependents_for_ignored_files()) {
            return compile_ignored_file(file.fullPath);
          } else {
            return compile_project('ignored file changed')
          }
        }
      }
      compile_single_file(file.fullPath);
    } else {
      // if the changed file was deleted, just remove it in the public folder
      try {
        var p = output_path(file.fullPath);
        fs.existsSync(p) && fs.unlinkSync(p);
      } catch(e) {
        roots.print.log("Error Unlinking File".inverse, 'red');
        roots.print.error(e);
      }
    }
  }
};

module.exports = { execute: _watch, needs_config: true };

function compile_single_file(file_path){
  roots.print.debug('single file compile: ' + file_path);
  roots.compile_project(file_path, function(){
    roots.print.log('finished compiling: ' + file_path)
    roots.print.reload();
  });
}

function compile_project(reason){
  roots.project.locals.site = {} // clear out site locals between reloads
  roots.print.debug(reason + ": full project compile");
  return roots.compile_project(roots.project.rootDir, function(){
    roots.print.log('finished compiling entire project');
    roots.print.reload();
  });
}

function compile_ignored_file(ignored_file_path) {

  roots.print.log("finding potential dependents to compile for ignored file: " + ignored_file_path);
  var retrieve_dependents_for_ignored_file = require(roots.project.config_path).retrieve_dependents_for_ignored_file;
  var dependent_file_paths = retrieve_dependents_for_ignored_file(ignored_file_path) || [];
  if (dependent_file_paths.length === 0) {
    roots.print.log("no dependents found, ignoring " + ignored_file_path);
  }
  dependent_file_paths.forEach(function(dependent_file_path) {
    roots.print.log("compiling dependent file " + dependent_file_path);
    compile_single_file(dependent_file_path);
  });
}
