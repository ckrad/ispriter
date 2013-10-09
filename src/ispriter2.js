
var fs = require('fs'),
    path = require('path'),

    us = require('underscore'),
    CSSOM = require('cssom'),
    PNG = require('pngjs').PNG,
    GrowingPacker = require('./GrowingPacker'),
    BI = require('./BackgroundInterpreter'),
    nf = require('./node-file'),
    zTool = require('./ztool');

//****************************************************************
// 0. 声明和配置一些常量
//****************************************************************

var CURRENT_DIR =  path.resolve('./');

/** 
 * 默认配置
 * 注意: 所有配置中, 跟路径有关的都必须使用 linux 的目录分隔符 "/", 不能使用 windows 的 "\". 
 */
var DEFAULT_CONFIG = {

    /**
     * 精灵图合并算法, 目前只有 growingpacker
     * 
     * @optional 
     * @default "growingpacker"
     */
    "algorithm": "growingpacker",
    "input": {

        /**
         * @test
         * 工作目录, 可以是相对路径或者绝对路径
         * 
         * @optional
         * @default 运行 ispriter 命令时所在的目录
         * @example
         * "./": 当前运行目录, 默认值
         * "../": 当前目录的上一级
         * "/data": 根目录下的 data 目录
         * "D:\\sprite": D 盘下的 sprite 目录
         */
        "workspace": CURRENT_DIR,

        /**
         * 原 cssRoot
         * 需要进行精灵图合并的 css 文件路径或文件列表, 单个时使用字符串, 多个时使用数组.
         * 
         * @required 
         * @example
         * "cssSource": "../css/";
         * "cssSource": ["../css/style.css", "../css2/*.css"]
         */
        "cssSource": null,

        /**
         * 输出的精灵图的格式, 目前只支持输出 png 格式, 
         * 如果是其他格式, 也是以PNG格式输出, 仅仅把后缀改为所指定后缀
         * 
         * @optional 
         * @default "png"
         */
        "format": "png"
    },
    "output": {

        /**
         * 原 cssRoot
         * 精灵图合并之后, css 文件的输出目录
         * 
         * @optional 
         * @default "./sprite/"
         */
        "cssDist": "./sprite/",

        /**
         * 原 imageRoot
         * 生成的精灵图相对于 cssDist 的路径, 最终会变成合并后的的图片路径写在 css 文件中
         * 
         * @optional
         * @default "./img/"
         * @example
         * 如果指定 imageDist 为 "./images/sprite/", 则在输出的 css 中会显示为
         * background: url("./images/sprite/sprite_1.png");
         * 
         */
        "imageDist": "./img/",

        /**
         * 原 maxSize
         * 单个精灵图的最大大小, 单位 KB, 
         * 如果合并之后图片的大小超过 maxSingleSize, 则会对图片进行拆分
         *
         * @optional 
         * @default 0
         * @example
         * 如指定 "maxSingleSize": 60, 而生成的精灵图(sprite_all.png)的容量为 80KB, 
         * 则会把精灵图拆分为 sprite_0.png 和 sprite_1.png 两张
         * 
         */
        "maxSingleSize": 0,

        /**
         * 合成之后, 图片间的空隙, 单位 px
         * 
         * @optional 
         * @default 0
         */
        "margin": 0,

        /**
         * 生成的精灵图的前缀
         * 
         * @optional
         * @default "sprite_"
         */
        "prefix": "sprite_",

        /**
         * 精灵图的输出格式
         * 
         * @optional
         * @default "png"
         */
        "format": "png",

        /**
         * 配置是否要将所有精灵图合并成为一张, 当有很多 css 文件输入的时候可以使用.
         * 为 true 时将所有图片合并为一张, 同时所有 css 文件合并为一个文件.
         * 注意: 此时 maxSingleSize 仍然生效, 超过限制时也会进行图片拆分
         * 
         * @optional
         * @default false
         */
        "combine": false
    }
};


//****************************************************************
// 1. 读取配置
// 把传入的配置(最简配置或者完整配置等)进行适配和整理
//****************************************************************

/**
 * 读取配置, 支持config 为配置文件名或者为配置对象
 * 
 * @param  {Object|String} config 配置文件或者配置对象
 * @return {Config}        读取并解析完成的配置对象
 */
var readConfig = function(config){
    if(us.isString(config)){
        if(!fs.existsSync(config)){
            throw 'place give in a sprite config or config file!';
        }
        var content = fs.readFileSync(config).toString();
        config = zTool.jsonParse(content);
    }
    config = config || {};

    // 适配最简配置
    if(us.isString(config.input)){
        config.input = {
            cssSource: config.input
        };
    }
    if(us.isString(config.output)){
        config.output = {
            cssSource: config.output
        }
    }

    // 对旧的配置项进行兼容
    config = adjustOldProperty(config);

    // 
    config = zTool.merge({}, DEFAULT_CONFIG, config);

    var cssSource = config.input.cssSource;
    if(!cssSource){
        throw 'there is no cssSource specific!';
    }else if(us.isString(cssSource)){
        cssSource = [cssSource];
    }

    // 读取所有指定的 css 文件
    var cssFiles = [], cssPattern, queryResult;
    for(var i = 0; i < cssSource.length; i++){
        cssPattern = path.normalize(cssSource[i]);

        if(zTool.endsWith(cssPattern, path.sep)){
            cssPattern += '*.css';
        }
        queryResult = nf.query(CURRENT_DIR, cssPattern);
        cssFiles = cssFiles.concat(queryResult);
    }
    if(!cssFiles.length){
        throw 'there is no any css file contain!';
    }

    // 去重
    cssFiles = us.unique(cssFiles);

    config.input.cssSource = cssFiles;

    // 确保输出路径是个目录
    config.output.cssDist = path.resolve(config.output.cssDist) + path.sep;
    
    // KB 换算成 B
    config.output.maxSingleSize *= 1024;

    // 确保 margin 是整数
    config.output.margin = parseInt(config.output.margin);
    
    console.log(config);
    return config;
}

/**
 * 对旧的配置项做兼容
 * @param  {Config} config 
 * @return {Config}        
 */
var adjustOldProperty = function(config){
    if(!config.input.cssSource && config.input.cssRoot){
        config.input.cssSource = config.input.cssRoot;
        delete config.input.cssRoot;
    }
    if(!config.output.cssDist && config.output.cssRoot){
        config.output.cssDist = config.output.cssRoot;
        delete config.output.cssRoot;
    }
    if(!config.output.imageDist && config.output.imageRoot){
        config.output.imageDist = config.output.imageRoot;
        delete config.output.imageRoot;
    }
    if(!config.output.maxSingleSize && config.output.maxSize){
        config.output.maxSingleSize = config.output.maxSize;
        delete config.output.maxSize;
    }
    return config;
}

//****************************************************************
// 2. CSS 样式处理
//****************************************************************

/**
 * 读取并解析样式表文件   
 * @return {CSSStyleSheet} 
 * @example
 * CSSStyleSheet: {
 *  cssRules: [
 *      { // CSSStyleDeclaration
 *         selectorText: "img",
 *         style: {
 *             0: "border",
 *             length: 1,
 *              border: "none"
 *          }
 *      }
 *   ]
 *  } 
 */
var readStyleSheet = function(fileName) {
    fileName = path.join(spriteConfig.input.workspace, fileName);
    if(!fs.existsSync(fileName)){
        return null;
    }
    var content = fs.readFileSync(fileName);
    var styleSheet = CSSOM.parse(content.toString());
    return styleSheet;
};

/**
 * CSS Style Declaration 的通用方法定义
 * @type {Object}
 * @example
 * CSSStyleDeclaration: {
 *     0: "border",
 *     1: "color",
 *     length: 2,
 *     border: "none",
 *     color: "#333"
 * }
 */
var BaseCSSStyleDeclaration = {

    /**
     * 把background 属性拆分
     * e.g. background: #fff url('...') repeat-x 0px top;
     */
    splitBackground: function(){
        var background, 
            value;

        if(!this['background']){

            // 有 background 属性的 style 才能拆分 background 
            return;
        }

        // 撕裂 background-position
        if(value = this['background-position']){
            value = value.trim().replace(/\s{2}/g,'').split(' ');
            if(!value[1]){
                value[1] = value[0];
            }
            this['background-position-x'] = value[0];
            this['background-position-y'] = value[1];
        }
        background = bgItpreter.analyse(this['background']);
        if(background.length != 1){

            // TODO 暂时跳过多背景的属性
            return;
        }
        background = background[0];
        if(background['background-image']){

            // 把原来缩写的 background 属性删掉
            this.removeProperty('background');

            this.extend(background);
        }
    },

    /**
     * 把 style 里面的 background 属性转换成简写形式, 用于减少代码
     */
    mergeBackgound: function(){
        var background = '', style = this;

        var positionText = this.removeProperty('background-position-x') + ' ' +
                           this.removeProperty('background-position-y');

        style['background-position'] = positionText.trim();

        var toMergeAttrs = [
               'background-color', 'background-image', 'background-position', 
               'background-repeat','background-attachment', 
               'background-origin', 'background-clip'
        ];
        for(var i = 0, item; item = toMergeAttrs[i]; i++) {
            if(style[item]){
                background += this.removeProperty(item) + ' ';
            }
        }
        style['background'] = background.trim();
        style[style.length++] = 'background';
    },

    /**
     * 把 obj 的属性和属性值扩展合并过来, 并调整下标, 方法将被忽略
     * @param  {Object} obj 
     * @param  {Boolean} override 是否覆盖也有属性
     */
    extend: function(obj, override){
        for(var i in obj){
            if(us.isFunction(obj[i])){
                continue;
            }else if(this[i] && !override){
                continue;
            }
            this.setProperty(i, obj[i], null);
        }

    }

}

/**
 * 所用到的一些正则
 */
var regexp = {
    ignoreNetwork: /^(https?|ftp):\/\//i,
    ignorePosition: /right|center|bottom/i,
    ignoreRepeat: /^(repeat-x|repeat-y|repeat)$/i,
    image: /\(['"]?(.+\.(png|jpg|jpeg))(\?.*?)?['"]?\)/i,
    css: /(.+\.css).*/i

}

/**
 * 收集需要合并的样式和图片
 * @param  {CSSStyleSheet} styleSheet 
 * @param  {Object} result StyleObjList
 * @return {Object}     
 * @example
 * result: {
 *     length: 1,
 *     "./img/icon1.png": { // StyleObj
 *         imageUrl: "./img/icon1.png",
 *         imageAbsUrl: "/User/home/ispriter/test/img/icon1.png",
 *         cssRules: []
 *     }
 * }
 */
var collectStyleRules = function(styleSheet, result, styleSheetUrl){
    if(!result){
        result = { // an StyleObjList
            length: 0
        }
    }

    if(!styleSheet.cssRules.length){
        return result;
    }

    var styleSheetDir = path.dirname(styleSheetUrl);

    // 遍历所有 css 规则收集进行图片合并的样式规则
    styleSheet.cssRules.forEach(function(rule, i){

        // typeof rule === 'CSSStyleRule'
        if(rule.href && rule.styleSheet){

            // @import 引入的样式表, 把 css 文件读取进来继续处理
            var fileName = rule.href;
            
            // 忽略掉链接到网络上的文件
            if(!fileName || !regexp.ignoreNetwork.test(fileName)){
                return;
            }
            var match = fileName.match(regexp.css);
            if(!match){
                return;
            }
            fileName = match[1];

            var styleSheet = readStyleSheet(fileName);
            if(!styleSheet){
                return;
            }
            rule.styleSheet = styleSheet;
            var url = path.join(styleSheetDir, fileName);

            // 继续收集 import 的样式
            collectStyleRules(styleSheet, result, url);
            return;
        }

        if(rule.cssRules && rule.cssRules.length){

            // 遇到有子样式的，比如 @media, @keyframes，递归收集
            collectStyleRules(rule, result, styleSheetUrl);
            return;
        }

        if(!rule.style){

            // 有可能 @media 等中没有任何样式, 如: @media xxx {}
            return;
        }

        /* 
         * typeof style === 'CSSStyleDeclaration'
         * 给 style 对象扩展基本的方法
         */
        var style = us.extend(rule.style, BaseCSSStyleDeclaration);

        if(style['background-size']){

            /* 
             * 跳过有 background-size 的样式, 因为:
             * 1. backgrond-size 不能简写在 background 里面, 而拆分 background 之后再组装, 
             *    background 就变成在 background-size 后面了, 会导致 background-size 被 background 覆盖;
             * 2. 拥有 backgrond-size 的背景图片一般都涉及到拉伸, 这类图片是不能合并的
             */
            return;
        }
        if(style['background']){
            
            // 有 background 属性的 style 就先把 background 简写拆分出来
            style.splitBackground();
        }
        
        if(regexp.ignorePosition.test(style['background-position-x']) || 
            regexp.ignorePosition.test(style['background-position-y'])){

            /*
             * background 定位是 right center bottom 的图片不合并
             * 因为这三个的定位方式比较特殊, 浏览器有个自动适应的特性
             * 把刚刚拆分的 background 属性合并并返回
             */
             style.mergeBackgound();
            return;
        }

        if(regexp.ignoreRepeat.test(style['background-repeat']) || 
            regexp.ignoreRepeat.test(style['background-repeat-x']) || 
            regexp.ignoreRepeat.test(style['background-repeat-y'])){

            // 显式的使用了平铺的图片, 也不进行合并
            style.mergeBackgound();
            return;
        }

        var imageUrl, imageAbsUrl;
        if(style['background-image'] && 
            style['background-image'].indexOf(',') == -1 && // TODO 忽略掉多背景的属性
            (imageUrl = getImageUrl(style['background-image']))){
            
            // 遇到写绝对路径的图片就跳过
            if(regexp.ignoreNetwork.test(imageUrl)){

                // 这里直接返回了, 因为一个style里面是不会同时存在两个 background-image 的
                return;
            }
            imageAbsUrl = path.join(styleSheetDir, imageUrl);
            if(!fs.existsSync(imageAbsUrl)){

                // 如果这个图片是不存在的, 就直接返回了, 进行容错
                return;
            }

            // 把用了同一个文件的样式汇集在一起
            if(!result[imageUrl]){
                result[imageUrl] = { // an StyleObj
                    imageUrl: imageUrl,
                    imageAbsUrl: imageAbsUrl,
                    cssRules: []
                };
                result.length++;
            }
            result[imageUrl].cssRules.push(style);
        }
    });
    return result;
}

/**
 * 从background-image 的值中提取图片的路径
 * @return {String}       url
 */
var getImageUrl = function(backgroundImage){
    var format = spriteConfig.input.format;
    var m = backgroundImage.match(regexp.image);
    if(m && format.indexOf(m[2]) > -1){
        return m[1];
    }
    return null;
}
//****************************************************************
// 3. 收集图片相关信息
//****************************************************************

/**
 * 读取图片的内容和大小
 * @param  {StyleObjList}   styleObjList 
 * @param  {Function} onDone     
 */
var readImagesInfo = function(styleObjList, onDone){

    // pngjs 没有提供同步 api, 所以只能用异步的方式读取图片信息
    zTool.forEach(styleObjList, function(styleObj, url, next){

        if(url === 'length'){
            return; // 跳过 styleObjList 的 length 字段
        }
        var imageInfo = imageInfoCache[url];

        var onGetImageInfo = function(imageInfo){
            imageInfoCache[url] = imageInfo;

            // 从所有style里面，选取图片宽高最大的作为图片宽高
            setImageWidthHeight(styleObj, imageInfo);

            styleObj.imageInfo = imageInfo;
            next();
        }

        if(imageInfo){
            onGetImageInfo(imageInfo);
        }else{
            readImageInfo(styleObj.imageAbsUrl, onGetImageInfo);
        }
    }, onDone);
}


/**
 * 读取单个图片的内容和信息
 * @param {String} fileName
 * @param {Function} callback callback(ImageInfo)
 * { // ImageInfo
 *     image: null, // 图片数据
 *     width: 0,
 *     height: 0,
 *     size: 0 // 图片数据的大小
 * }
 */
var readImageInfo = function(fileName, callback){
    fs.createReadStream(fileName).pipe(new PNG())
    .on('parsed', function() {

        var imageInfo = {
            image: this,
            width: this.width,
            height: this.height
        };

        getImageSize(this, function(size){

            imageInfo.size = size;
            callback(imageInfo);
        });
    });
}

/**
 * 读取图片内容所占硬盘空间的大小
 * @param  {PNG}   image    
 * @param  {Function} callback callback(Number)
 */
var getImageSize = function(image, callback){
    var size = 0;
    image.pack().on('data', function(chunk){

        size += chunk.length;
    }).on('end', function(){

        callback(size);
    });
}

/**
 * 把用了同一个图片的样式里写的大小 (with, height) 跟图片的大小相比较, 取最大值,
 * 防止有些样式写的宽高比较大, 导致合并后显示到了周边的图片内容
 * @param {StyleObj} styleObj 
 * @param {ImageInfo} imageInfo 
 */
var setImageWidthHeight = function(styleObj, imageInfo){
    var w = 0, 
        h = 0, 
        mw = imageInfo.width, 
        mh = imageInfo.height
    ;
    for(var i = 0, rule; rule = styleObj.cssRules[i]; i++) {
        w = getPxValue(rule.width),
        h = getPxValue(rule.height);
        if(w > mw){
            mw = w;
        }
        if(h > mh){
            mh = h;
        }
    }
    styleObj.w = mw + spriteConfig.output.margin;
    styleObj.h = mh + spriteConfig.output.margin;
}

/**
 * 把像素值转换成数字, 如果没有该值则设置为 0
 * @param  {String} cssValue 
 */
var getPxValue = function(cssValue){
    if(cssValue && cssValue.indexOf('px') > -1){
        return parseInt(cssValue);
    }
    return 0;
}

//****************************************************************
// 4. 对图片进行坐标定位
//****************************************************************

/**
 * 对需要合并的图片进行布局定位
 * @param  {StyleObjList} styleObjList 
 * @return {Array} 返回 StyleObj 的数组, 数组的每个元素都是一张图片的内容
 */
var positionImages = function(styleObjList){
    var styleObjArr = [], 
        arr = [], 
        existArr = [], // 保存已经合并过的图片的样式
        maxSize = spriteConfig.output.maxSingleSize,
        packer = new GrowingPacker()
    ;

    // 把已经合并了并已输出的图片先排除掉
    styleObjList.forEach(function(styleObj){
        if(styleObj.imageInfo.drew){
            existArr.push(styleObj);
        }else{
            arr.push(styleObj);
        }
    });

    // 如果限制了输出图片的大小, 则进行分组
    if(maxSize){

        /* 
         * 限制图片大小的算法是:
         * 1. 先把图片按从大到小排序
         * 2. 顺序叠加图片 size , 超过maxSize 时, 另起一个数组
         * 3. 最终把一个数组, 拆成 N 个 总 szie 小于 maxSize 的数组
         */
        arr.sort(function(a, b){
            return b.imageInfo.size - a.imageInfo.size;
        });
        
        var total = 0, ret = [];
        arr.forEach(function(styleObj){
            total += styleObj.imageInfo.size;

            if(total > maxSize){
                if(ret.length){ // 避免出现空图片
                    styleObjArr.push(ret);
                    ret = [];
                    total = styleObj.imageInfo.size;
                }
            }
            ret.push(styleObj);
        });

        if(ret.length){
            styleObjArr.push(ret);
        }
    }else{
        styleObjArr.push(arr);
    }
    
    /* 
     * packer 算法需要把最大的一个放在首位...
     * 排序算法会对结果造成比较大的影响
     */
    for(var j = 0; arr = styleObjArr[j]; j++) {
        arr.sort(function(a, b){
            return b.w * b.h - a.w * a.h;
        });
        //packer 定位
        packer.fit(arr);
        arr.root = packer.root;
    }
    if(existArr.length){
        styleObjArr.push(existArr);
    }
    // console.log(styleObjArr.length, styleObjArr);
    // console.log('-------------------------------');
    return styleObjArr;
}

//****************************************************************
// 主逻辑
//****************************************************************

// sprite 的配置
var spriteConfig = null;

// sprite 缓存
var spriteCache = null;

// sprite 完成之后的回调
var onSpriteDone = null;

// 记录 sprite 开始的时间
var spriteStart = 0;

// 图片信息缓存
var imageInfoCache = null;

// sprite 数据的缓存, 用于需要合并所有 css 文件和图片的情况
var spriteObjList = null;

/**
 * sprite 开始之前执行的函数
 */
var onSpriteStart = function(){
    spriteStart = +new Date;
}

/**
 * sprite 完成之后执行的函数
 */
var onSpriteEnd = function(){
    var timeUse = +new Date - spriteStart;
    console.log('>>all done. time use:', timeUse, 'ms');
    onSpriteDone && onSpriteDone(timeUse);
}

/**
 * ispriter 的主要入口函数
 * @param  {Object|String} config ispriter 的配置对象或者是配置文件, 
 * 如不清楚请参照 README.md
 * @param {Function} done 当精灵图合并完成后触发
 */
exports.merge = function(config, done){
    onSpriteStart();

    spriteCache = {};
    onSpriteDone = done;

    imageInfoCache = {};
    spriteObjList = [];

    // 1. 读取和处理合图配置
    spriteConfig = readConfig(config);

    // 2. 读取文件内容并解析, 读取相关图片的信息
    zTool.forEach(spriteConfig.input.cssSource, function(cssFile, i, next){ // onEach

        var spriteObj = { // an SpriteObj
            cssFile: cssFile, // css 文件的路径
            styleSheet: readStyleSheet(cssFile), // css 文件的内容
            styleObjList: null // 搜集到的需要合并图片的样式和相关图片信息(大小宽高等)
        };

        // 收集需要合并的图片信息
        var styleObjList = collectStyleRules(spriteObj.styleSheet, null, cssFile);
        spriteObj.styleObjList = styleObjList;

        // 把结果塞到列表中方便 combine 使用
        spriteObjList.push(spriteObj);

        if(!styleObjList.length){
            next(); // 这个 css 没有需要合并的图片
        }else{

            // 读取图片的内容, 宽高和大小
            readImagesInfo(styleObjList, next);
        }
    }, function(){ // onDone

        // 3. 对小图片进行定位排列和输出, 输出合并后的 css 文件
        if(!spriteConfig.output.combine){

        }
        spriteObjList.forEach(function(spriteObj){
            var styleObjArr = positionImages(spriteObj.styleObjList);

            //输出合并的图片 并修改样式表里面的background
            drawImageAndPositionBackground(styleObjArr, fileName);

            //输出修改后的样式表
            writeCssFile(spriteObj);
        });
    });

}

// Task.JS Specification API https://github.com/taskjs/spec
exports.run = function(options, done){
    exports.merge(options, done);
}

//****************************************************************
// 0000. for test
//****************************************************************
readConfig('./config.example.json');