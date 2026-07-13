const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const CleanCSS = require("clean-css");
const { minify: minifyHtml } = require("html-minifier-terser");
const { minify: minifyJs } = require("terser");
const {
    getBookingPaymentRequired,
    renderBookingSubmitActions,
} = require("../booking-payment");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const sourceAssetsDir = path.join(rootDir, "assets");
const distAssetsDir = path.join(distDir, "assets");

const textAssets = {
    "styles.css": "assets/app.css",
    "assets/js/app-alert.js": "assets/js/app-alert.js",
    "assets/js/booking.js": "assets/js/booking.js",
    "assets/js/main.js": "assets/js/main.js",
};

const htmlOptions = {
    collapseBooleanAttributes: true,
    collapseWhitespace: true,
    conservativeCollapse: true,
    decodeEntities: true,
    minifyCSS: true,
    minifyJS: true,
    removeAttributeQuotes: false,
    removeComments: true,
    removeRedundantAttributes: true,
};

function hashContent(content) {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 10);
}

function addHash(filePath, content) {
    const parsed = path.parse(filePath);
    return path.join(parsed.dir, `${parsed.name}.${hashContent(content)}${parsed.ext}`);
}

function isPublicAsset(sourcePath) {
    const relativePath = path.relative(sourceAssetsDir, sourcePath);
    const parts = relativePath.split(path.sep);
    const basename = path.basename(sourcePath);

    if (basename.startsWith(".")) {
        return false;
    }

    return parts[0] !== "js";
}

async function copyPublicAssets() {
    await fs.cp(sourceAssetsDir, distAssetsDir, {
        recursive: true,
        filter: isPublicAsset,
    });
}

async function writeHashedAsset(sourcePath, outputPath) {
    const absoluteSourcePath = path.join(rootDir, sourcePath);
    const source = await fs.readFile(absoluteSourcePath, "utf8");
    const extension = path.extname(sourcePath);
    let output;

    if (extension === ".css") {
        const minified = new CleanCSS({ level: 2 }).minify(source);

        if (minified.errors.length > 0) {
            throw new Error(`CSS minification failed for ${sourcePath}: ${minified.errors.join("; ")}`);
        }

        output = minified.styles;
    } else if (extension === ".js") {
        const minified = await minifyJs(source, {
            compress: true,
            mangle: true,
            format: {
                comments: false,
            },
        });

        if (!minified.code) {
            throw new Error(`JS minification failed for ${sourcePath}`);
        }

        output = minified.code;
    } else {
        output = source;
    }

    const hashedPath = addHash(outputPath, output);
    const absoluteOutputPath = path.join(distDir, hashedPath);

    await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await fs.writeFile(absoluteOutputPath, output);

    return hashedPath.split(path.sep).join("/");
}

function rewriteHtmlReferences(html, assetManifest) {
    return Object.entries(assetManifest).reduce(
        (updatedHtml, [sourcePath, outputPath]) => updatedHtml.replaceAll(sourcePath, outputPath),
        html,
    );
}

function renderHtmlForBuild(sourcePath, html, paymentRequired) {
    if (sourcePath !== "index.html") return html;

    return renderBookingSubmitActions(html, paymentRequired);
}

async function writeHtml(sourcePath, outputPath, assetManifest, paymentRequired) {
    const absoluteSourcePath = path.join(rootDir, sourcePath);
    const absoluteOutputPath = path.join(distDir, outputPath);
    const source = await fs.readFile(absoluteSourcePath, "utf8");
    const rendered = renderHtmlForBuild(sourcePath, source, paymentRequired);
    const rewritten = rewriteHtmlReferences(rendered, assetManifest);
    const minified = await minifyHtml(rewritten, htmlOptions);

    await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await fs.writeFile(absoluteOutputPath, `${minified.trimEnd()}\n`);
}

async function build() {
    const paymentRequired = getBookingPaymentRequired();

    await fs.rm(distDir, { recursive: true, force: true });
    await fs.mkdir(distDir, { recursive: true });
    await copyPublicAssets();

    const assetManifest = {};

    for (const [sourcePath, outputPath] of Object.entries(textAssets)) {
        assetManifest[sourcePath] = await writeHashedAsset(sourcePath, outputPath);
    }

    await writeHtml("index.html", "index.html", assetManifest, paymentRequired);
    await writeHtml(
        "taplink/index.html",
        "taplink/index.html",
        assetManifest,
        paymentRequired,
    );

    console.log(`Built ${path.relative(rootDir, distDir)}`);
}

if (require.main === module) {
    require("dotenv").config({ path: path.join(rootDir, ".env") });

    build().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { renderHtmlForBuild };
