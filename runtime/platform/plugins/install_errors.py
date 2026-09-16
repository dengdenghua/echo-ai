"""Public installation diagnostics; never expose URLs, paths or credentials."""

import httpx


def installation_failure(exc: Exception) -> tuple[int, dict[str, object]]:
    message = str(exc).lower()
    code, status, retryable = "INSTALL_FAILED", 500, False
    if isinstance(exc, httpx.HTTPStatusError):
        upstream = exc.response.status_code
        if upstream == 404:
            code, status = "PACKAGE_UNAVAILABLE", 409
        elif upstream in {401, 403}:
            code, status = "PACKAGE_ACCESS_DENIED", 409
        else:
            code, status, retryable = "PACKAGE_SERVICE_UNAVAILABLE", 502, upstream >= 500 or upstream == 429
    elif isinstance(exc, (httpx.RequestError, TimeoutError, ConnectionError)):
        code, status, retryable = "PACKAGE_SERVICE_UNAVAILABLE", 502, True
    elif isinstance(exc, KeyError) and "not found in content pack" in message:
        code, status = "PACKAGE_UNAVAILABLE", 409
    elif isinstance(exc, PermissionError):
        code, status = "INSTALL_WRITE_DENIED", 409
    elif isinstance(exc, ValueError):
        if "第三方宿主" in message:
            code, status = "ECHO_ADAPTER_REQUIRED", 409
        elif any(word in message for word in ("signature", "checksum", "signed package", "untrusted")):
            code, status = "PACKAGE_VERIFICATION_FAILED", 409
        elif "dependency" in message or "host_api" in message:
            code, status = "PACKAGE_INCOMPATIBLE", 409
    messages = {
        "INSTALL_FAILED": "安装未完成，请查看插件诊断后再操作。",
        "PACKAGE_UNAVAILABLE": "目录包含此插件，但发布包中尚未提供。请更新目录或等待 Echo 发布适配包。",
        "PACKAGE_ACCESS_DENIED": "插件发布服务拒绝下载，请检查 Echo 的发布服务配置。重新登录插件账号不能解决此问题。",
        "PACKAGE_SERVICE_UNAVAILABLE": "插件发布服务暂时无法访问，请检查网络后重试。",
        "INSTALL_WRITE_DENIED": "无法写入 Echo 插件目录，请检查目录权限。",
        "ECHO_ADAPTER_REQUIRED": "此插件需要 Echo 专用接入配置，当前不能使用第三方宿主配置安装。",
        "PACKAGE_VERIFICATION_FAILED": "插件包签名或完整性验证失败，请更新可信发布包。",
        "PACKAGE_INCOMPATIBLE": "插件依赖或 Echo 版本不兼容，请检查安装计划。",
    }
    return status, {"code": code, "message": messages[code], "retryable": retryable}
