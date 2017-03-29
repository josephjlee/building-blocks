'use strict';

import plugins      from 'gulp-load-plugins';
import yargs        from 'yargs';
import browser      from 'browser-sync';
import gulp         from 'gulp';
import panini       from 'panini';
import rimraf       from 'rimraf';
import sherpa       from 'style-sherpa';
import yaml         from 'js-yaml';
import fs           from 'fs';
import sassLint     from 'gulp-sass-lint';
import gulpRename   from 'gulp-rename';
import _            from 'lodash';
import requireDir   from 'require-dir';

// Load all Gulp plugins into one variable
const $ = plugins();

// load subtasks
requireDir('./gulp/tasks');

// Check for --production flag
const PRODUCTION = !!(yargs.argv.production);

// Load settings from settings.yml
const { COMPATIBILITY, PORT, UNCSS_OPTIONS, PATHS } = loadConfig();

function loadConfig() {
  let ymlFile = fs.readFileSync('config.yml', 'utf8');
  return yaml.load(ymlFile);
}

// Lint task
gulp.task('lint', function () {
  return gulp.src('src/assets/scss/**/*.s+(a|c)ss')
  .pipe(sassLint())
  .pipe(sassLint.format())
  .pipe(sassLint.failOnError())
});

// Build the "dist" folder by running all of the below tasks
gulp.task('build',
 gulp.series(clean, 'lint', gulp.parallel(pages, sass, javascript, images, copy), styleGuide));

// Build the site, run the server, and watch for file changes
gulp.task('default',
  gulp.series('build', server, watch));

gulp.task('bb-iframe',
  gulp.series(clean,'building-block-meta', buildingBlockSass, buildingBlockJS, buildingBlockPage, buildingBlockIframe, 'building-block-indices', sass, javascript, images, copy,));

// Create Building Blocks
gulp.task('bb',
  gulp.series('bb-iframe', server, watch ));

// Delete the "dist" folder
// This happens every time a build starts
function clean(done) {
  rimraf(PATHS.dist, () => rimraf(PATHS.build, done));
}

// Copy files out of the assets folder
// This task skips over the "img", "js", and "scss" folders, which are parsed separately
function copy() {
  return gulp.src(PATHS.assets)
    .pipe(gulp.dest(PATHS.dist + '/assets'));
}

// Copy page templates into finished HTML files
function pages() {
  return gulp.src('src/pages/**/*.{html,hbs,handlebars}')
    .pipe(panini({
      root: 'src/pages/',
      layouts: 'src/layouts/',
      partials: 'src/partials/',
      data: 'src/data/',
      helpers: 'src/panini-helpers/'
    }))
    .pipe(gulp.dest(PATHS.dist));
  }

// Resets Panini so that we can assemble using different layouts for the iframes and building block pages
function getNewPanini(options) {
  var p = new panini.Panini(options);
  p.loadBuiltinHelpers();
  p.refresh();
  return p.render()
}

// Create a building block
function buildingBlockIframe() {
  return gulp.src('src/building-blocks/**/*.{html,hbs,handlebars}')
    .pipe(getNewPanini({
      root: 'src/',
      layouts: 'src/layouts/building-blocks/iframe/',
      partials: 'src/partials/building-block/',
      data: 'src/data/',
      helpers: 'src/panini-helpers/'
    }))
    .pipe(gulpRename(function (path) {
      path.basename += "-iframe";
    }))
    .pipe(gulp.dest(PATHS.dist + "/building-block/"));
}

// Compiles the Sass for the building blocks
function buildingBlockSass() {
  return gulp.src(['src/building-blocks/app.scss', 'src/building-blocks/**/*.scss'])
    .pipe($.sass({
      includePaths: PATHS.sass
    })
      .on('error', $.sass.logError))
    .pipe($.autoprefixer({
      browsers: COMPATIBILITY
    }))
    // Comment in the pipe below to run UnCSS in production
    //.pipe($.if(PRODUCTION, $.uncss(UNCSS_OPTIONS)))
    .pipe($.if(PRODUCTION, $.cssnano()))
    .pipe(gulp.dest(PATHS.dist + "/building-block/"))
    .pipe(browser.reload({ stream: true }));
}

// Moves JS from the Building Blocks into the dist
function buildingBlockJS() {
  return gulp.src('src/building-blocks/**/*.js')
    .pipe(gulp.dest(PATHS.dist + "/building-block/"));
}

// Compiles the building block page
function buildingBlockPage() {
  return gulp.src('src/building-blocks/**/*.{html,hbs,handlebars}')
    .pipe(getNewPanini({
      root: 'src/',
      layouts: 'src/layouts/building-blocks/page/',
      partials: 'src/partials',
      data: ['src/data/', PATHS.build + '/data'],
      helpers: 'src/panini-helpers/'
    }))
    .pipe(gulp.dest(PATHS.dist + "/building-block/"));
}

// Load updated HTML templates and partials into Panini
function resetPages(done) {
  panini.refresh();
  done();
}

// Generate a style guide from the Markdown content and HTML template in styleguide/
function styleGuide(done) {
  sherpa('src/styleguide/index.md', {
    output: PATHS.dist + '/styleguide.html',
    template: 'src/styleguide/template.html'
  }, done);
}

// Compile Sass into CSS
// In production, the CSS is compressed
function sass() {
  return gulp.src('src/assets/scss/app.scss')
    .pipe($.sourcemaps.init())
    .pipe($.sass({
      includePaths: PATHS.sass
    })
      .on('error', $.sass.logError))
    .pipe($.autoprefixer({
      browsers: COMPATIBILITY
    }))
    // Comment in the pipe below to run UnCSS in production
    //.pipe($.if(PRODUCTION, $.uncss(UNCSS_OPTIONS)))
    .pipe($.if(PRODUCTION, $.cssnano()))
    .pipe($.if(!PRODUCTION, $.sourcemaps.write()))
    .pipe(gulp.dest(PATHS.dist + '/assets/css'))
    .pipe(browser.reload({ stream: true }));
}

// Combine JavaScript into one file
// In production, the file is minified
function javascript() {
  return gulp.src(PATHS.javascript)
    .pipe($.sourcemaps.init())
    .pipe($.babel({ignore: ['what-input.js']}))
    .pipe($.concat('app.js'))
    .pipe($.if(PRODUCTION, $.uglify()
      .on('error', e => { console.log(e); })
    ))
    .pipe($.if(!PRODUCTION, $.sourcemaps.write()))
    .pipe(gulp.dest(PATHS.dist + '/assets/js'));
}

// Copy images to the "dist" folder
// In production, the images are compressed
function images() {
  return gulp.src('src/assets/img/**/*')
    .pipe($.if(PRODUCTION, $.imagemin({
      progressive: true
    })))
    .pipe(gulp.dest(PATHS.dist + '/assets/img'));
}

// Start a server with BrowserSync to preview the site in
function server(done) {
  browser.init({
    server: PATHS.dist, port: PORT
  });
  done();
}

// Reload the browser with BrowserSync
function reload(done) {
  browser.reload();
  done();
}

// Watch for changes to static assets, pages, Sass, and JavaScript
function watch() {
  gulp.watch(PATHS.assets, copy);
  gulp.watch('src/pages/**/*.html').on('all', gulp.series(pages, browser.reload));
  gulp.watch('src/{layouts,partials}/**/*.html').on('all', gulp.series('bb-iframe', browser.reload));
  gulp.watch('src/building-blocks/**/*.html').on('all', gulp.series('bb-iframe', browser.reload));
  gulp.watch('src/assets/scss/**/*.scss').on('all', gulp.series(sass, buildingBlockSass, browser.reload));
  gulp.watch('src/assets/js/**/*.js').on('all', gulp.series(javascript, browser.reload));
  gulp.watch('src/assets/img/**/*').on('all', gulp.series(images, browser.reload));
  gulp.watch('src/styleguide/**').on('all', gulp.series(styleGuide, browser.reload));
}
