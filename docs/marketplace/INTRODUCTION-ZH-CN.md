# ReferenceSync

将 Instagram、Pinterest、Behance、Vimeo、X、Dribbble、Layers 和 Threads 的已保存参考素材导入 Eagle。先查看结果、选择媒体，再自定义名称和描述，并保留来源链接与标签。

## 开始使用

**点击“准备引擎”即可。在支持的 macOS/Windows 系统上，无需手动安装 Python 或使用终端。**

插件先查找已有且兼容的 Python 3.10+ 和 pip。如果未找到，会从 Astral 的 python-build-standalone GitHub 发布版本下载独立便携 Python，验证固定 SHA-256 后安装到 ReferenceSync 工作目录。随后从您配置的软件包索引（通常为 PyPI）安装 gallery-dl、带 curl_cffi 的 yt-dlp、pycryptodomex 和 imageio-ffmpeg。不修改系统 Python、PATH 或注册表，也不需要管理员权限。Windows ARM64 通过 x64 模拟运行，需要 Windows 11。

仅在您点击按钮后才会下载组件。打开插件或检查组件不会自动安装 Python。关闭插件可以取消准备；未完成文件会清理，之后可重试。

先在浏览器中登录对应网站，再选择该浏览器及用户配置。搜索素材、检查选择，然后下载并添加到 Eagle。

## 支持的流程

- Instagram 收藏帖子和 Pinterest 图钉，支持收藏夹筛选与单个媒体选择。
- Behance 内容块、以 .rscase 保存的整个项目，或同时导入两者。**在 Eagle 中查看 .rscase 需要另行安装 ReferenceCanvas。** ReferenceSync 不会安装该插件。
- 支持的 Instagram/Pinterest/Threads ZIP、JSON 或 HTML 归档元数据。帖子链接仍需联网解析；归档不保证无需登录或网络就能下载媒体。
- Vimeo 默认搜索 Favorites，可选择 Watch Later 和 Showcases；X 支持 Bookmarks 及符合条件的 Premium 书签文件夹。
- Dribbble、Layers 和 Threads 的已保存合集，可按文件夹选择。Dribbble 支持多个媒体及每个内容块的描述；Layers 每个作品只有一个媒体。点赞为独立模式，不与已保存合集混合；不包含自行发布的作品。这四个来源尚未确认兼容的收藏归档格式。
- Instagram、Behance（Appreciations）、Vimeo、X、Dribbble、Layers 和 Threads 提供独立的点赞模式，使用浏览器中已登录的账号，不使用数据归档或文件夹选择。Pinterest 爱心反应不是收藏历史列表。Vimeo 点赞与原有的默认 Favorites 相同。
- Threads 支持已保存、点赞与单个帖子，以及图片、视频和混合轮播的选择。完整 Meta ZIP 只读取已保存列表，也可选择支持的独立 JSON/HTML。纯文字帖子会跳过；回复与同一会话后续帖子不会合并，不提供文件夹选择。
- 查找新帖子、检查全部收藏或点赞内容，或限制最近帖子的数量。导入前可选用编号；素材库专属导入记录帮助避免重复。

网站变更、浏览器 Cookie 保护、账号权限、无法访问的媒体或请求频率限制，都可能导致下载失败。

## 数据与访问权限

插件不会索取密码。所选浏览器及用户配置中的 Cookie 用于向对应网站发起身份验证请求。临时快照在导出前设置私有权限，导出后验证，使用结束后删除。异常退出后，已结束进程的快照在后续启动时清理；不带进程标识的旧快照在 24 小时后清理。

部分 Behance 视频会通过 Eagle 内的隔离临时 Vimeo 播放器解析。该页面执行 Vimeo 自身的代码，没有 Node.js 或 Eagle API 访问权限，也不会接收所选浏览器的 Cookie。下载器只接受经过验证的 Vimeo CDN HTTPS 地址。Dribbble 的常规浏览器请求遇到访问检查时，也可能使用临时隔离页面；该页面不接收浏览器 Cookie，也没有 Node.js 或 Eagle API 权限，使用后会关闭。

设置、导入记录、恢复数据、独立 Python、依赖项和下载暂存文件保存在主目录的 .reference-sync 中。未完成下载可能保留以便恢复。Behance 的完整 .rscase 组装并验证成功后会删除临时源内容块；单独选中导入的内容块会保留。完整项目会保留至确认导入 Eagle。所选文件及元数据会添加到 Eagle；原始浏览器数据和归档不会删除。插件没有分析统计或向开发者上传数据的服务，连接用于所选网站、其媒体服务、软件包索引及本机 Eagle API。卸载不会自动删除工作数据。分享日志或目录前，请阅读随附的隐私说明。
