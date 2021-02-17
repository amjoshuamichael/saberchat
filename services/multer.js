const multer = require('multer');
const path = require('path');
const util = require('util');

const storage = multer.memoryStorage();
const imageFilter = (req, file, callback) => {
    const ext = path.extname(file.originalname);
    const extensions = [".png", ".jpg", ".jpeg", ".gif", ".mp4", ".mp3", ".m4a", ".pdf"];
    if (!extensions.includes(ext.toLowerCase())) {
        return callback(new Error('Invalid Media Format'));
    }
    callback(null, true);
};

const multerConfig = {
    storage: storage,
    fileFilter: imageFilter,
    limits: {
        fileSize: 3 * 10 ** 8
    }
};

module.exports.uploadSingle = util.promisify(multer(multerConfig).fields([{name: "imageFile", maxCount: 1}, {name: "imageFile2", maxCount: 1}]));
module.exports.uploadMultiple = util.promisify(multer(multerConfig).fields([{name: "imageFile", maxCount: 3}, {name: "imageFile2", maxCount: 3}])); //Max 3 uploads (might change, discuss as a team)
