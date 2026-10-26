import { useCallback, useState } from "react";
import Loader from "@/components/Loader";
import { fetchWithTimeout, parseJsonResponse } from "@/lib/fetchJson";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import { uploadVideoToMeta, useVideoProcessingPoll } from "@/lib/catalogAds/videoUpload";
import AiCopyBox from "./AiCopyBox";
import styles from "@/styles/Home.module.css";

const CTAS = [
  { value: "SHOP_NOW", label: "Shop now" },
  { value: "BUY_NOW", label: "Buy now" },
  { value: "ORDER_NOW", label: "Order now" },
  { value: "GET_OFFER", label: "Get offer" },
  { value: "LEARN_MORE", label: "Learn more" },
];

const MAX_BYTES = 3 * 1024 * 1024;

function pageWebsite(p) {
  const first = (p?.website || "").split(/[\s,]+/).find(Boolean);
  if (!first) return "";
  return /^https?:\/\//i.test(first) ? first : `https://${first}`;
}

// Image, video or existing-post ad — ported from sr-ads-launch's
// StandardAdSection. Image upload is a single request (base64, under 3 MB);
// video goes through lib/catalogAds/videoUpload.js's chunked upload +
// processing-status poll.
export default function StandardAdFields({ accountId, pages, value, onChange }) {
  function set(patch) {
    onChange({ ...value, ...patch });
  }

  const page = pages.find((p) => p.id === value.pageId);
  const ig = page?.instagram_business_account;

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [videoProgress, setVideoProgress] = useState(0);
  const [processingPct, setProcessingPct] = useState(null);

  // Calls `onChange` with a functional update (React's setState form, not
  // `set()`'s plain object merge) rather than closing over `value` — this
  // callback is handed to useVideoProcessingPoll once and then called from
  // a poll loop that can run for minutes, by which point `value` from this
  // render would be stale and a status update would silently roll back any
  // editing done to the rest of the ad in the meantime.
  const onVideoStatus = useCallback(
    (update) => {
      if (update.status) onChange((prev) => ({ ...prev, videoStatus: update.status }));
      if (typeof update.progress === "number") setProcessingPct(update.progress);
    },
    [onChange]
  );
  const checkNow = useVideoProcessingPoll(value.videoId, value.videoStatus, onVideoStatus);

  const postsRes = useJsonFetch(
    value.kind === "POST" && value.pageId && (value.postSource === "FACEBOOK" || ig?.id)
      ? `/api/fb/catalog-ads/posts?pageId=${encodeURIComponent(value.pageId)}&source=${value.postSource}${ig?.id ? `&igId=${encodeURIComponent(ig.id)}` : ""}`
      : null
  );
  const posts = postsRes.data?.posts || [];

  async function onVideo(file) {
    const objectUrl = URL.createObjectURL(file);
    setVideoProgress(0);
    setProcessingPct(null);
    set({ videoStatus: "uploading", videoUrl: objectUrl, videoId: "", imageHash: "", imageUrl: "", imageName: file.name });
    try {
      const { videoId, imageHash, imageUrl } = await uploadVideoToMeta(file, accountId, setVideoProgress);
      set({ videoId, videoStatus: "processing", imageHash, imageUrl });
    } catch (err) {
      setUploadError(err.message);
      set({ videoStatus: "", videoId: "", videoUrl: "", imageHash: "", imageUrl: "", imageName: "" });
    }
  }

  async function onFile(file) {
    if (!file) return;
    setUploadError("");
    if (/^video\/(mp4|quicktime)$/.test(file.type)) {
      await onVideo(file);
      return;
    }
    if (!/^image\/(jpeg|png)$/.test(file.type)) {
      setUploadError("Use a JPG or PNG image, or an MP4 or MOV video.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError("Image must be under 3 MB.");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const bytes = dataUrl.split(",")[1];
      const res = await fetchWithTimeout("/api/fb/catalog-ads/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, name: file.name, bytes }),
      });
      const json = await parseJsonResponse(res);
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      set({ imageHash: json.hash, imageUrl: dataUrl, imageName: file.name, videoId: "", videoStatus: "", videoUrl: "" });
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Ad name
        </p>
        <input type="text" className={styles.select} style={{ width: "100%" }} value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Facebook Page
        </p>
        <select
          className={styles.select}
          style={{ width: "100%" }}
          value={value.pageId}
          onChange={(e) => {
            const p = pages.find((x) => x.id === e.target.value);
            const website = pageWebsite(p);
            set({ pageId: e.target.value, instagramUserId: p?.instagram_business_account?.id || "", postId: "", link: value.kind === "UPLOAD" && website ? website : value.link });
          }}
        >
          <option value="" disabled>
            Select a Page…
          </option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {ig && value.kind === "UPLOAD" && (
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={!!value.instagramUserId} onChange={(e) => set({ instagramUserId: e.target.checked ? ig.id : "" })} />
            Run on Instagram as @{ig.username || ig.id}
          </label>
        )}
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Ad type
        </p>
        <div className={styles.tabGroup}>
          <button type="button" className={value.kind === "UPLOAD" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ kind: "UPLOAD" })}>
            Upload an image or video
          </button>
          <button type="button" className={value.kind === "POST" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ kind: "POST" })}>
            Existing post
          </button>
        </div>
      </div>

      {value.kind === "UPLOAD" ? (
        <>
          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Image or video
            </p>
            <input
              type="file"
              accept="image/jpeg,image/png,video/mp4,video/quicktime"
              disabled={uploading || value.videoStatus === "uploading"}
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {value.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- local object/data URL preview, not worth Next/Image config for this
              <img src={value.imageUrl} alt="" style={{ maxWidth: 200, display: "block", marginTop: 8, borderRadius: 6 }} />
            )}
            {uploading && <Loader label="Uploading image to Meta…" inline />}
            {value.videoStatus === "uploading" && (
              <div style={{ marginTop: 8 }}>
                <Loader label={`Uploading video to Meta… ${Math.round(videoProgress * 100)}%`} inline />
              </div>
            )}
            {value.videoStatus === "processing" && (
              <p className={styles.sub} style={{ marginTop: 6 }}>
                Meta is processing the video{processingPct != null && processingPct > 0 ? `: ${processingPct}%` : ""}. This usually takes under a
                minute; you can keep editing.{" "}
                <button type="button" className={styles.btnSecondary} onClick={() => checkNow.current()}>
                  Check now
                </button>
              </p>
            )}
            {value.videoStatus === "ready" && <p className={styles.sub} style={{ marginTop: 6, color: "var(--green)" }}>Video ready on Meta.</p>}
            {value.videoStatus === "error" && <div className={styles.error}>Meta couldn&apos;t process this video. Upload a different file.</div>}
            {uploadError && <div className={styles.error}>{uploadError}</div>}
          </div>

          <AiCopyBox
            accountId={accountId}
            imageHash={value.imageHash}
            pageName={page?.name || ""}
            link={value.link}
            cta={CTAS.find((c) => c.value === value.cta)?.label}
            ad={value}
            onUse={(patch) => set(patch)}
          />

          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Primary text
            </p>
            <textarea
              className={styles.select}
              style={{ width: "100%", minHeight: 60, resize: "vertical" }}
              value={value.message}
              onChange={(e) => set({ message: e.target.value })}
            />
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Headline
              </p>
              <input type="text" className={styles.select} style={{ width: "100%" }} value={value.headline} onChange={(e) => set({ headline: e.target.value })} />
            </div>
            <div style={{ flex: 1 }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Description
              </p>
              <input type="text" className={styles.select} style={{ width: "100%" }} value={value.description} onChange={(e) => set({ description: e.target.value })} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Button
              </p>
              <select className={styles.select} style={{ width: "100%" }} value={value.cta} onChange={(e) => set({ cta: e.target.value })}>
                {CTAS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Website URL
              </p>
              <input type="text" className={styles.select} style={{ width: "100%" }} placeholder="https://yourstore.com" value={value.link} onChange={(e) => set({ link: e.target.value })} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Post from
            </p>
            <div className={styles.tabGroup}>
              <button type="button" className={value.postSource === "FACEBOOK" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => set({ postSource: "FACEBOOK", postId: "" })}>
                Facebook Page
              </button>
              <button
                type="button"
                className={value.postSource === "INSTAGRAM" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                disabled={!ig}
                title={!ig ? "This Page has no connected Instagram account" : undefined}
                onClick={() => set({ postSource: "INSTAGRAM", postId: "" })}
              >
                Instagram account
              </button>
            </div>
          </div>
          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Select post
            </p>
            {!value.pageId ? (
              <p className={styles.sub}>Select a Page first.</p>
            ) : postsRes.loading ? (
              <Loader label="Loading posts…" inline />
            ) : postsRes.error ? (
              <div className={styles.error}>{postsRes.error}</div>
            ) : !posts.length ? (
              <p className={styles.sub}>No recent posts found.</p>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
                {posts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => set({ postId: p.id })}
                    className={styles.card}
                    style={{ padding: 8, textAlign: "left", cursor: "pointer", border: value.postId === p.id ? "2px solid var(--purple)" : undefined }}
                  >
                    <div
                      style={{
                        width: "100%",
                        aspectRatio: "1 / 1",
                        borderRadius: 6,
                        background: p.image ? `center/cover no-repeat url("${p.image}")` : "var(--card2)",
                        marginBottom: 6,
                      }}
                    />
                    <div className={styles.clamp3} style={{ fontSize: 12 }}>
                      {p.text || "No caption"}
                    </div>
                    <div className={styles.sub} style={{ margin: 0, fontSize: 11 }}>
                      {p.time ? new Date(p.time).toLocaleDateString("en-IN") : ""}
                      {p.type === "REELS" ? " · Reel" : p.type === "VIDEO" ? " · Video" : p.type === "CAROUSEL_ALBUM" ? " · Carousel" : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
