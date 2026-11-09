//! Shared allocation limits for local input. Large account exports are streamed;
//! individual sessions/documents and decompressed records have a smaller budget.
use std::io::{self, Read};
use std::path::Path;

pub const DOCUMENT_BYTES: u64 = 64 * 1024 * 1024;
pub const EXPORT_BYTES: u64 = 1024 * 1024 * 1024;

pub struct LimitedReader<R> {
    reader: R,
    remaining: u64,
}

impl<R> LimitedReader<R> {
    pub fn new(reader: R, limit: u64) -> Self {
        Self { reader, remaining: limit }
    }
}

impl<R: Read> Read for LimitedReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        if self.remaining == 0 {
            return match self.reader.read(&mut [0])? {
                0 => Ok(0),
                _ => Err(io::Error::other("input exceeds the size limit")),
            };
        }
        let len = buf.len().min(self.remaining as usize);
        let n = self.reader.read(&mut buf[..len])?;
        self.remaining -= n as u64;
        Ok(n)
    }
}

pub fn read_bounded(reader: impl Read, limit: u64) -> io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err(io::Error::other("input exceeds the size limit"));
    }
    Ok(bytes)
}

pub fn read_text(path: &Path) -> io::Result<String> {
    let file = std::fs::File::open(path)?;
    if file.metadata()?.len() > DOCUMENT_BYTES {
        return Err(io::Error::other("input exceeds the size limit"));
    }
    String::from_utf8(read_bounded(file, DOCUMENT_BYTES)?).map_err(io::Error::other)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_exact_limit_and_rejects_actual_excess() {
        assert_eq!(read_bounded(&b"1234"[..], 4).unwrap(), b"1234");
        assert!(read_bounded(&b"12345"[..], 4).is_err());
    }

    #[test]
    fn streaming_reader_accepts_exact_eof_and_rejects_extra_bytes() {
        let mut exact = LimitedReader::new(&b"1234"[..], 4);
        let mut text = String::new();
        exact.read_to_string(&mut text).unwrap();
        assert_eq!(text, "1234");
        assert!(LimitedReader::new(&b"12345"[..], 4).read_to_string(&mut String::new()).is_err());
    }
}
