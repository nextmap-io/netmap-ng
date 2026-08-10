from typing import Annotated
from urllib.parse import urlsplit

from pydantic import AfterValidator


def _validate_http_url(value: str) -> str:
    """Allow only absolute HTTP(S) URLs in editor click-through fields."""
    value = value.strip()
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("URL must be an absolute http:// or https:// URL")
    return value


SafeHttpUrl = Annotated[str, AfterValidator(_validate_http_url)]
