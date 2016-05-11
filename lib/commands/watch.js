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
  roots.print.log("PERFORMANCE NOTE".green)
  roots.print.log("   Use retrieve_dependents_for_file in app.coffee to make explicit".green);
  roots.print.log("   dependencies to prevent total rebuilds for every change.\n".green);
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

  function retrieve_dependents_for_file(file_path) {

    if (roots.project.config_path) {
      var helper = require(roots.project.config_path).retrieve_dependents_for_file;
      if (helper) {
        return helper(file_path) || [];
      }
    }
    return [];
  }

  function watch_function(file){

    // make sure the file wasn't deleted
    if (fs.existsSync(file.fullPath)){

      roots.print.log("detected change: " + file.fullPath);

      // Smartly compile dependencies if the app.coffee exposed a
      // retrieve_dependents_for_file helper to override dependencies
      // in cases where a full rebuild isn't necessary.
      var dependents = retrieve_dependents_for_file(file.fullPath);
      if (dependents.length) {
        roots.print.log("saving compile time using retrieve_dependents_for_file - found " + dependents.length + " dependencies of " + file.fullPath);
        if (yaml_parser.detect(file.fullPath)) {
          compile_single_file(file.fullPath);
        }
        dependents.forEach(function(dependent_path) {
          compile_single_file(dependent_path);
        });
        return;
      }

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
          roots.print.log("ignoring file and all dependents (could result in some inconsistencies): " + file.fullPath);
          return;
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
  roots.print.log('single file compile: ' + file_path);
  roots.compile_project(file_path, function(){
    roots.print.log('finished compiling: ' + file_path)
  });
}

function compile_project(reason){
  roots.project.locals.site = {} // clear out site locals between reloads
  roots.print.log(reason + ": full project compile");
  return roots.compile_project(roots.project.rootDir, function(){
    roots.print.log('finished compiling entire project');
  });
}
