function readPackage(pkg, context) {
  if (pkg.name === 'echarts-for-taro') {
    context.log('Blocked installation of echarts-for-taro');

    throw new Error('Restricted: The package "echarts-for-taro" does not exist. Please remove it and update the code referencing it.');
  }

  if (pkg.name === 'file-saver') {
    context.log('Blocked installation of file-saver');

    throw new Error(`Restricted: The package "file-saver" is not compatible with WeChat Mini Programs.
Please use Taro's built-in file APIs instead:
- Taro.downloadFile(): Download files to temporary path
- Taro.saveFile(): Save temporary files to persistent storage
- Taro.openDocument(): Open documents (PDF, Word, Excel, PPT)

Example usage:
// Download and save a file
Taro.downloadFile({
  url: 'https://example.com/file.pdf',
  success: (res) => {
    // Save the temporary file
    Taro.saveFile({
      tempFilePath: res.tempFilePath,
      success: (saveRes) => {
        console.log('File saved to:', saveRes.savedFilePath);
      }
    });
  }
});`);
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage
  }
};
