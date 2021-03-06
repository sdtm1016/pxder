/*
 * @Author: Jindai Kirin 
 * @Date: 2018-08-23 08:44:16 
 * @Last Modified by: Jindai Kirin
 * @Last Modified time: 2018-08-27 16:14:50
 */

const NekoTools = require('crawl-neko').getTools();
const Illust = require('./illust');
const Illustrator = require('./illustrator');
const Fs = require("fs");
const Fse = require('fs-extra');
const Path = require("path");
const Tools = require('./tools');
require('colors');

const pixivRefer = 'https://www.pixiv.net/';

let config;
let httpsAgent = false;


function setConfig(conf) {
	config = conf;
}

function setAgent(agent) {
	httpsAgent = agent;
}


/**
 * 下载画师们的画作
 *
 * @param {Array<Illustrator>} illustrators 画师数组
 * @param {Function} callback 每成功下载完一个画师时运行的回调
 */
async function downloadByIllustrators(illustrators, callback) {
	for (let i in illustrators) {
		let illustrator = illustrators[i];
		let info;

		await illustrator.info();

		process.stdout.write("\nCollecting illusts of " + (parseInt(i) + 1).toString().green + "/" + illustrators.length + " uid=".gray + illustrator.id.toString().cyan + " " + illustrator.name.yellow + " .");
		let dots = setInterval(() => process.stdout.write('.'), 2000);

		//取得下载信息
		await getDownloadListByIllustrator(illustrator).then(ret => info = ret);

		clearInterval(dots);
		console.log("  Done".green);

		//下载
		await downloadIllusts(info.illusts, Path.join(config.path, info.dir), config.thread);

		//回调
		if (typeof (callback) == 'function') callback(i);
	}
}


/**
 * 获得该画师需要下载的画作列表
 *
 * @param {Illustrator} illustrator
 * @returns
 */
async function getDownloadListByIllustrator(illustrator) {
	let illusts = [];

	//得到画师下载目录
	let dir;
	await illustrator.info().then(getIllustratorNewDir).then(ret => dir = ret);

	//最新画作检查
	let exampleIllusts = illustrator.exampleIllusts;
	let existNum = 0;
	for (let ei of exampleIllusts) {
		if (Fs.existsSync(Path.join(config.path, dir, ei.file))) existNum++;
		else illusts.push(ei);
	}
	if (existNum > 0) {
		return {
			dir,
			illusts: illusts.reverse()
		}
	}

	//得到未下载的画作
	illusts = [];
	let cnt;
	do {
		cnt = 0;
		let temps;
		await illustrator.illusts().then(ret => temps = ret);
		for (let temp of temps) {
			if (!Fs.existsSync(Path.join(config.path, dir, temp.file))) {
				illusts.push(temp);
				cnt++;
			}
		}
	} while (illustrator.hasNext('illust') && cnt > 0);

	return {
		dir,
		illusts: illusts.reverse()
	}
}


/**
 * 下载自己的收藏
 *
 * @param {Illustrator} me 自己
 * @param {boolean} [isPrivate=false] 是否是私密
 * @returns
 */
async function downloadByBookmark(me, isPrivate = false) {
	//得到画师下载目录
	let dir = '[bookmark] ' + (isPrivate ? 'Private' : 'Public');

	process.stdout.write("\nCollecting illusts of your bookmark .");
	let dots = setInterval(() => process.stdout.write('.'), 2000);

	//得到未下载的画作
	let illusts = [];
	let cnt;
	do {
		cnt = 0;
		let temps;
		await me.bookmarks().then(ret => temps = ret);
		for (let temp of temps) {
			if (!Fs.existsSync(Path.join(config.path, dir, temp.file))) {
				illusts.push(temp);
				cnt++;
			}
		}
	} while (me.hasNext('bookmarks') && cnt > 0);

	clearInterval(dots);
	console.log("  Done".green);

	//下载
	await downloadIllusts(illusts.reverse(), Path.join(config.path, dir), config.thread);
}


/**
 * 多线程下载插画队列
 *
 * @param {Array<Illust>} illusts 插画队列
 * @param {string} dldir 下载目录
 * @param {number} totalThread 下载线程
 * @returns 成功下载的画作数
 */
function downloadIllusts(illusts, dldir, totalThread) {
	let tempDir = Path.join(dldir, "temp");
	let totalI = 0;
	//清除残留的临时文件
	if (Fs.existsSync(tempDir)) Fse.removeSync(tempDir);

	//开始多线程下载
	return new Promise((resolve, reject) => {
		let doneThread = 0;

		//单个线程
		async function singleThread(threadID) {
			let i = totalI++;
			let illust = illusts[i];

			//线程终止
			if (!illust) {
				//当最后一个线程终止时结束递归
				if ((++doneThread) >= totalThread) {
					if (Fs.existsSync(tempDir)) Fse.removeSync(tempDir);
					resolve();
				}
				return;
			}

			//开始下载
			console.log("  [%d]\t%s/%d\t" + " pid=".gray + "%s\t%s", threadID, (parseInt(i) + 1).toString().green, illusts.length, illust.id.toString().cyan, illust.title.yellow);
			async function tryDownload(times) {
				if (times > 10) return;
				let options = {
					headers: {
						referer: pixivRefer
					},
					timeout: 1000 * config.timeout
				};
				//代理
				if (httpsAgent) options.httpsAgent = httpsAgent;
				//失败重试
				return NekoTools.download(tempDir, illust.file, illust.url, options)
					.then(() => Fs.renameSync(Path.join(tempDir, illust.file), Path.join(dldir, illust.file)))
					.catch(() => {
						console.log("  " + (times >= 10 ? "[%d]".bgRed : "[%d]".bgYellow) + "\t%s/%d\t" + " pid=".gray + "%s\t%s", threadID, (parseInt(i) + 1).toString().green, illusts.length, illust.id.toString().cyan, illust.title.yellow);
						return tryDownload(times + 1);
					});
			}
			await tryDownload(1);
			singleThread(threadID);
		}

		//开始多线程
		for (let t = 0; t < totalThread; t++)
			singleThread(t).catch(e => {
				reject(e);
			});
	});
}


/**
 * 得到某个画师对应的下载目录名
 *
 * @param {*} data 画师资料
 * @returns 下载目录名
 */
async function getIllustratorNewDir(data) {
	//下载目录
	let mainDir = config.path;
	if (!Fs.existsSync(mainDir)) NekoTools.mkdirsSync(mainDir);
	let dldir = null;

	//先搜寻已有目录
	await Tools.readDirSync(mainDir).then(files => {
		for (let file of files) {
			if (file.indexOf('(' + data.id + ')') === 0) {
				dldir = file;
				break;
			}
		}
	});

	//去除画师名常带的摊位后缀，以及非法字符
	let iName = data.name;
	let nameExtIndex = iName.search(/@|＠/);
	if (nameExtIndex >= 1) iName = iName.substring(0, nameExtIndex);
	iName = iName.replace(/[/\\:*?"<>|.&\$]/g, '').replace(/[ ]+$/, '');
	let dldirNew = '(' + data.id + ')' + iName;

	//决定下载目录
	if (!dldir) {
		dldir = dldirNew;
	} else if (config.autoRename && dldir != dldirNew) {
		console.log("\nDirectory renamed: %s => %s", dldir.yellow, dldirNew.green);
		Fs.renameSync(Path.join(mainDir, dldir), Path.join(mainDir, dldirNew));
		dldir = dldirNew;
	}

	return dldir;
}


module.exports = {
	setConfig,
	setAgent,
	downloadByIllustrators,
	downloadByBookmark
};
