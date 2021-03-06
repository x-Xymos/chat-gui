require('dotenv').config();

const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const fs = require('fs');
const path = require('path');
const webpack = require('webpack');
const util = require('util');
const crypto = require('crypto');
const CleanWebpackPlugin = require('clean-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HTMLWebpackPlugin = require('html-webpack-plugin');
const imageSize = util.promisify(require('image-size'));
const flatten = require('flatten');
const { GENERIFY_OPTIONS, TAGS } = require('./assets/chat/js/const');

const fsReadDirAsync = util.promisify(fs.readdir);
const fsReadFileAsync = util.promisify(fs.readFile);

class EmoteManifestPlugin {
    constructor(options) {
        this.options = options;
    }

    apply(compiler) {
        compiler.hooks.emit.tapAsync('HtmlWebpackPlugin', async (compilation, callback) => {
            const cssChunkFile = compilation.entrypoints.get(this.options.cssChunk).getFiles().find(name => /\.css$/.test(name));
            const indexJSON = await fsReadFileAsync(this.options.index);
            const { default: emoteNames } = JSON.parse(indexJSON);

            const images = flatten(await Promise.all([
                this.processImages(this.options.emoteRoot, '1x', false),
                this.processImages(this.options.animatedEmoteRoot, '1x', true),
                this.processImages(path.join(this.options.emoteRoot, '2x'), '2x', false),
                this.processImages(path.join(this.options.animatedEmoteRoot, '2x'), '2x', true),
                this.processImages(path.join(this.options.emoteRoot, '4x'), '4x', false),
                this.processImages(path.join(this.options.animatedEmoteRoot, '4x'), '4x', true)
            ]));

            const emotes = await Promise.all(emoteNames.map(async (emoteName) => {
                const emoteImages = images.filter(({ name }) => name === emoteName);

                if (emoteImages.length === 0) {
                    throw new Error(`missing file for emote ${emoteName}`);
                }

                const versions = emoteImages.map(({ ext, hash, name, src, animated, dimensions, size }) => {
                    const path = `${this.options.emotePath}/${name}.${hash}${ext}`;
                    compilation.assets[path] = {
                        source: () => src,
                        size: () => src.length
                    };

                    return {
                        path,
                        animated,
                        dimensions,
                        size
                    };
                });

                return {
                    name: emoteName,
                    versions
                };
            }));

            const json = JSON.stringify({
                emotes,
                css: cssChunkFile,
                modifiers: this.options.modifiers,
                tags: this.options.tags
            });

            compilation.assets[this.options.filename] = {
                source: () => json,
                size: () => json.length
            };

            return callback();
        });
    }

    async processImages(root, size, animated) {
        const entries = await fsReadDirAsync(root, { withFileTypes: true });
        return Promise.all(entries.filter(entry => entry.isFile()).map(async ({ name }) => {
            const filePath = path.join(root, name);
            const src = await fsReadFileAsync(filePath);

            const hash = crypto.createHash('sha1');
            hash.write(src);

            const ext = path.extname(name);

            const { height, width } = await await imageSize(filePath);

            return {
                name: path.basename(name, ext),
                dimensions: { height, width },
                hash: hash.digest().toString('hex').substring(0, 6),
                ext,
                src,
                size,
                animated
            }
        }));
    }
}

const plugins = [
    new CopyWebpackPlugin([
        { from: 'robots.txt' }
    ]),
    new CleanWebpackPlugin(
        ['static'],
        {
            root: __dirname,
            verbose: false,
            exclude: ['cache', 'index.htm']
        }
    ),
    new HTMLWebpackPlugin({
        filename: 'index.html',
        template: 'assets/index.html',
        favicon: './assets/chat/img/favicon.ico',
        chunks: ['chat', 'emotes']
    }),
    new HTMLWebpackPlugin({
        filename: 'chatstreamed.html',
        template: 'assets/chatstreamed.html',
        favicon: './assets/chat/img/favicon.ico',
        chunks: ['chatstreamed', 'emotes']
    }),
    new HTMLWebpackPlugin({
        filename: 'notification-request.html',
        template: 'assets/notification-request/notification-request.html',
        favicon: './assets/chat/img/favicon.ico',
        chunks: ['notification-request']
    }),
    new MiniCssExtractPlugin({ filename: '[name].[contentHash].css' }),
    new webpack.DefinePlugin({
        WEBSOCKET_URI: process.env.WEBSOCKET_URI ? `'${process.env.WEBSOCKET_URI}'` : '"wss://chat.strims.gg/ws"',
        API_URI: process.env.API_URI ? `'${process.env.API_URI}'` : '""',
        LOGIN_URI: process.env.LOGIN_URI ? `'${process.env.LOGIN_URI}'` : 'false',
        RUSTLA_URL: process.env.RUSTLA_URL ? `'${process.env.RUSTLA_URL}'` : 'https://strims.gg'
    }),
    new EmoteManifestPlugin({
        filename: 'emote-manifest.json',
        emotePath: 'img/emotes',
        index: './assets/emotes.json',
        emoteRoot: './assets/emotes/emoticons',
        animatedEmoteRoot: './assets/emotes/emoticons-animated/gif',
        cssChunk: 'emotes',
        modifiers: Object.keys(GENERIFY_OPTIONS),
        tags: TAGS
    })
];

const entry = {
    'chat': [
        'core-js/es6',
        'jquery',
        'normalize.css',
        'font-awesome/scss/font-awesome.scss',
        './assets/chat/js/notification',
        './assets/chat/css/style.scss',
        './assets/chat.js',
        './assets/sounds/notification.wav'
    ],
    'chatstreamed': [
        'core-js/es6',
        'jquery',
        'normalize.css',
        'font-awesome/scss/font-awesome.scss',
        './assets/chat/js/notification',
        './assets/chat/css/style.scss',
        './assets/chat/css/onstream.scss',
        './assets/streamchat.js'
    ],
    'emotes': [
        './assets/chat/css/emotes.scss'
    ],
    'notification-request': [
        './assets/notification-request/style.scss',
        './assets/notification-request/persona.png',
        './assets/notification-request/settings-guide.png',
        './assets/notification-request/script.js'
    ],
};

if (process.env.NODE_ENV !== 'production') {
    console.log('\n!!!!!!!!!!!! DEVELOPMENT BUILD !!!!!!!!!!!!\n');

    plugins.push(
        new CopyWebpackPlugin([
            { from: 'assets/dev/chat-embedded.html', to: 'dev/' }
        ]),
        new HTMLWebpackPlugin({
            filename: 'dev/dev-chat.html',
            template: 'assets/index.html',
            chunks: ['dev-chat', 'emotes']
        })
    );

    entry['dev-chat'] = [
        'core-js/es6',
        'jquery',
        'normalize.css',
        'font-awesome/scss/font-awesome.scss',
        './assets/chat/css/style.scss',
        './assets/dev/dev-chat/dev-chat.js'
    ];
} else {
    console.log('\n########## PRODUCTION BUILD #############\n');
}

module.exports = {
    devServer: {
        contentBase: path.join(__dirname, 'static'),
        compress: true,
        port: 8282,
        https: process.env.WEBPACK_DEVSERVER_HTTPS === 'true',
        host: process.env.WEBPACK_DEVSERVER_HOST
    },
    entry: entry,
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    output: {
        path: path.resolve(__dirname, 'static'),
        hashDigestLength: 6,
        filename: '[name].[contentHash].js'
    },
    plugins: plugins,
    watchOptions: {
        ignored: /node_modules/
    },
    module: {
        rules: [
            {
                test: /\.html$/,
                loader: 'html-loader?attrs=img:src'
            },
            {
                test: /\.(ts|tsx)$/,
                use: [
                    'babel-loader',
                    'ts-loader'
                ]
            },
            {
                test: /\.js$/,
                exclude: path.resolve(__dirname, 'node_modules'),
                loader: 'babel-loader'
            },
            {
                test: /\.(scss|css)$/,
                use: [
                    MiniCssExtractPlugin.loader,
                    'css-loader',
                    'postcss-loader',
                    'sass-loader'
                ]
            },
            {
                test: /\.(eot|svg|ttf|woff2?)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
                loader: 'file-loader',
                options: { name: 'fonts/[name].[md5:hash:base64:6].[ext]' }
            },
            {
                test: /\.(png|jpg|gif|svg)$/,
                exclude: path.resolve(__dirname, 'node_modules/font-awesome/'),
                loader: 'file-loader',
                options: { name: 'img/[name].[md5:hash:base64:6].[ext]' }
            },
            {
                test: /\.(mp3|wav)$/i,
                loader: 'file-loader',
                options: {
                    name: '[path][name].[ext]'
                }
            }
        ]
    },
    resolve: {
        alias: {
            jquery: 'jquery/src/jquery'
        },
        extensions: ['.ts', '.tsx', '.js']
    },
    context: __dirname,
    devtool: process.env.NODE_ENV !== 'production' && 'source-map'
};
