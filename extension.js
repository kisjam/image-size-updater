const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

function getImageDimensions(filePath) {
	const buf = fs.readFileSync(filePath);

	if (isPng(buf)) return pngDimensions(buf);
	if (isJpeg(buf)) return jpegDimensions(buf);
	if (isWebp(buf)) return webpDimensions(buf);
	return null;
}

function isPng(buf) {
	return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function pngDimensions(buf) {
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function isJpeg(buf) {
	return buf[0] === 0xff && buf[1] === 0xd8;
}

function jpegDimensions(buf) {
	let i = 2;
	while (i + 4 < buf.length) {
		if (buf[i] !== 0xff) break;
		const marker = buf[i + 1];
		const segLen = buf.readUInt16BE(i + 2);
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
		i += 2 + segLen;
	}
	return null;
}

function isWebp(buf) {
	return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

function webpDimensions(buf) {
	const type = buf.toString('ascii', 12, 16);
	if (type === 'VP8 ') {
		return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
	}
	if (type === 'VP8L') {
		const bits = buf.readUInt32LE(21);
		return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
	}
	if (type === 'VP8X') {
		return {
			width: (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1,
			height: (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1,
		};
	}
	return null;
}

function resolveImagePath(srcPath, workspaceFolder) {
	const documentRoot = vscode.workspace.getConfiguration('imageSizeUpdater').get('documentRoot') ?? '';
	const root = documentRoot ? path.join(workspaceFolder, documentRoot) : workspaceFolder;
	return path.join(root, srcPath);
}

function applyDimensions(line, dims) {
	return line.replace(/<img([^>]*)>/i, (match, attrs) => {
		const cleaned = attrs
			.replace(/\s+width="\d+"/g, '')
			.replace(/\s+height="\d+"/g, '');
		return `<img${cleaned} width="${dims.width}" height="${dims.height}">`;
	});
}

function activate(context) {
	const cmd = vscode.commands.registerCommand('imageSizeUpdater.updateImageSize', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;

		const lineNum = editor.selection.active.line;
		const line = editor.document.lineAt(lineNum).text;
		const match = line.match(/src="([^"]+)"/);
		if (!match) {
			vscode.window.showInformationMessage('img src が見つかりません');
			return;
		}

		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceFolder) return;

		const resolved = resolveImagePath(match[1], workspaceFolder);
		if (!fs.existsSync(resolved)) {
			vscode.window.showErrorMessage(`ファイルが見つかりません: ${resolved}`);
			return;
		}

		const dims = getImageDimensions(resolved);
		if (!dims) {
			vscode.window.showErrorMessage('画像サイズを取得できませんでした');
			return;
		}

		await editor.edit(eb => {
			eb.replace(editor.document.lineAt(lineNum).range, applyDimensions(line, dims));
		});
	});

	context.subscriptions.push(cmd);
}

exports.activate = activate;
exports.deactivate = () => {};
