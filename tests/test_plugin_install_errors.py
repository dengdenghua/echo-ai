import httpx
import pytest

from runtime.platform.plugins.install_errors import installation_failure


@pytest.mark.parametrize("upstream,code,retryable", [
    (404, "PACKAGE_UNAVAILABLE", False),
    (403, "PACKAGE_ACCESS_DENIED", False),
    (503, "PACKAGE_SERVICE_UNAVAILABLE", True),
])
def test_upstream_failure_is_safe_and_actionable(upstream, code, retryable):
    request = httpx.Request("GET", "https://example.com/package?token=secret")
    exc = httpx.HTTPStatusError("secret", request=request, response=httpx.Response(upstream, request=request))
    _, detail = installation_failure(exc)
    assert detail["code"] == code
    assert detail["retryable"] is retryable
    assert "secret" not in str(detail)


def test_missing_content_is_not_a_transient_network_error():
    status, detail = installation_failure(KeyError("plugin not found in content pack: demo"))
    assert status == 409
    assert detail["code"] == "PACKAGE_UNAVAILABLE"


def test_signature_failure_does_not_suggest_retry_or_expose_paths():
    _, detail = installation_failure(ValueError("signature invalid at C:/private/token"))
    assert detail["code"] == "PACKAGE_VERIFICATION_FAILED"
    assert detail["retryable"] is False
    assert "private" not in str(detail)
