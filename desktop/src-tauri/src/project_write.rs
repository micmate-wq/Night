// Write beside the destination so rename is atomic on the same filesystem.
use std::{fs::{self, OpenOptions}, io::{self, Write}, path::Path};
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT: AtomicU64 = AtomicU64::new(0);

pub fn replace_project(path: &Path, content: &[u8]) -> io::Result<()> {
    replace_with(path, |file| file.write_all(content))
}

fn replace_with(path: &Path, write: impl FnOnce(&mut fs::File) -> io::Result<()>) -> io::Result<()> {
    let parent = path.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let temp = parent.join(format!(".aether-save-{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut file = OpenOptions::new().write(true).create_new(true).open(&temp)?;
    let result = (|| {
        write(&mut file)?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_write_preserves_previous_save_and_cleans_temp() {
        let dir = std::env::temp_dir().join(format!("aether-write-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.aether");
        fs::write(&path, b"previous complete project").unwrap();
        let result = replace_with(&path, |f| {
            f.write_all(b"partial new project")?;
            Err(io::Error::new(io::ErrorKind::Other, "simulated disk failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"previous complete project");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 1);
        replace_project(&path, b"new complete project").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new complete project");
        let destination_dir = dir.join("invalid-destination");
        fs::create_dir(&destination_dir).unwrap();
        assert!(replace_project(&destination_dir, b"data").is_err());
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }
}
