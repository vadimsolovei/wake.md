const gulp = require('gulp')

module.exports = function copyPHP() {
  return gulp.src(['src/*.php'])
    .pipe(gulp.dest('build/'))
}


