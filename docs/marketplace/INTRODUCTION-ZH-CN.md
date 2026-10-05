# ReferenceSync

将 Instagram、Pinterest 和 Behance 参考素材导入 Eagle。先查看结果、选择媒体，再自定义名称和描述，并保留来源链接与标签。

## 开始使用

**请先自行安装 Python 3.10 或更高版本。ReferenceSync 不会安装 Python。**

点击下载引擎准备按钮，插件通过已有的 Python 安装或更新 gallery-dl、带 curl_cffi 的 yt-dlp 和 imageio-ffmpeg。依赖项从您配置的 Python 软件包索引（通常为 PyPI）下载到插件自己的运行目录。若缺少 pip，Python 的 ensurepip 可能会在所选 Python 安装中准备 pip。

先在浏览器中登录对应网站，再选择该浏览器及用户配置。搜索素材、检查选择，然后下载并添加到 Eagle。

## 支持的流程

- Instagram 收藏帖子和 Pinterest 图钉，支持收藏夹筛选与单个媒体选择。
- Behance 内容块、以 .rscase 保存的整个项目，或同时导入两者。**在 Eagle 中查看 .rscase 需要另行安装 ReferenceCanvas。** ReferenceSync 不会安装该插件。
- 支持的 Instagram/Pinterest ZIP、JSON 或 HTML 归档元数据。帖子链接仍需联网解析；归档不保证无需登录或网络就能下载媒体。
- 查找新帖子、检查全部收藏或限制最近帖子的数量。导入前可选用编号；素材库专属导入记录帮助避免重复。

本版本的 Dribbble、Vimeo、X 和 Layers 来源按钮不可用。网站变更、浏览器 Cookie 保护、账号权限、无法访问的媒体或请求频率限制，都可能导致下载失败。

## 数据与访问权限

插件不会索取密码。所选浏览器及用户配置中的 Cookie 用于向对应网站发起身份验证请求。临时快照在导出前设置私有权限，导出后验证，使用结束后删除。异常退出后，已结束进程的快照在后续启动时清理；不带进程标识的旧快照在 24 小时后清理。

部分 Behance 视频会通过 Eagle 内的隔离临时 Vimeo 播放器解析。该页面执行 Vimeo 自身的代码，没有 Node.js 或 Eagle API 访问权限，也不会接收所选浏览器的 Cookie。下载器只接受经过验证的 Vimeo CDN HTTPS 地址。

设置、导入记录、恢复数据、依赖项和下载暂存文件保存在主目录的 .reference-sync 中。未完成下载可能保留以便恢复。所选文件及元数据会添加到 Eagle；原始浏览器数据和归档不会删除。插件没有分析统计或向开发者上传数据的服务，连接用于所选网站、其媒体服务、软件包索引及本机 Eagle API。卸载不会自动删除工作数据。分享日志或目录前，请阅读随附的隐私说明。
