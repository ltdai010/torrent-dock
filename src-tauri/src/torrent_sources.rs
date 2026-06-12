use std::time::Duration;

use futures_util::future;
use futures_util::stream::{FuturesUnordered, StreamExt};
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use url::{form_urlencoded, Url};

const SEARCH_LIMIT_PER_PROVIDER: usize = 8;
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) TorrentDock/0.1";
const DEFAULT_TRACKERS: &[&str] = &[
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
    "udp://exodus.desync.com:6969/announce",
];

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderResult {
    id: String,
    provider_id: String,
    provider_name: String,
    title: String,
    source_url: String,
    magnet_uri: Option<String>,
    torrent_url: Option<String>,
    info_hash_v1: Option<String>,
    info_hash_v2: Option<String>,
    size: Option<u64>,
    seeders: Option<u32>,
    leechers: Option<u32>,
    category: Option<String>,
    license_hint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSearchError {
    provider_id: String,
    provider_name: String,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSearchResponse {
    results: Vec<ProviderResult>,
    errors: Vec<ProviderSearchError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MovieTitleCandidate {
    id: String,
    title: String,
    year: Option<u16>,
    kind: String,
    credits: Option<String>,
    image_url: Option<String>,
    search_title: String,
}

#[derive(Deserialize)]
struct ImdbSuggestionResponse {
    d: Option<Vec<ImdbSuggestionItem>>,
}

#[derive(Deserialize)]
struct ImdbSuggestionItem {
    id: Option<String>,
    l: Option<String>,
    q: Option<String>,
    qid: Option<String>,
    s: Option<String>,
    y: Option<u16>,
    i: Option<ImdbSuggestionImage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImdbSuggestionImage {
    image_url: Option<String>,
}

#[derive(Deserialize)]
struct TpbApiResult {
    id: String,
    name: String,
    info_hash: String,
    leechers: String,
    seeders: String,
    size: String,
    category: String,
}

struct Parsed1337xRow {
    rank: usize,
    source_url: String,
    title: String,
    category: Option<String>,
    seeders: Option<u32>,
    leechers: Option<u32>,
    size: Option<u64>,
}

#[tauri::command]
pub async fn search_torrent_sources(query: String) -> Result<ProviderSearchResponse, String> {
    let query = query.trim();

    if query.len() < 2 {
        return Err("Enter at least 2 characters to search sources.".to_string());
    }

    let client = source_search_client()?;

    let mut results = Vec::new();
    let mut errors = Vec::new();
    let (search_1337x_result, pirate_bay_result) = future::join(
        search_1337x(&client, query),
        search_the_pirate_bay(&client, query),
    )
    .await;

    match search_1337x_result {
        Ok(mut provider_results) => results.append(&mut provider_results),
        Err(message) => errors.push(provider_error("1337x", "1337x", message)),
    }

    match pirate_bay_result {
        Ok(mut provider_results) => results.append(&mut provider_results),
        Err(message) => errors.push(provider_error("the-pirate-bay", "The Pirate Bay", message)),
    }

    Ok(ProviderSearchResponse {
        results: dedupe_results(results),
        errors,
    })
}

#[tauri::command]
pub async fn search_torrent_source_provider(
    query: String,
    provider_id: String,
) -> Result<Vec<ProviderResult>, String> {
    let query = query.trim();

    if query.len() < 2 {
        return Err("Enter at least 2 characters to search sources.".to_string());
    }

    let client = source_search_client()?;

    match provider_id.as_str() {
        "1337x" => search_1337x(&client, query).await,
        "the-pirate-bay" => search_the_pirate_bay(&client, query).await,
        _ => Err(format!("Unknown source provider: {provider_id}")),
    }
}

#[tauri::command]
pub async fn search_movie_titles(query: String) -> Result<Vec<MovieTitleCandidate>, String> {
    let query = normalized_text(&query);

    if query.len() < 2 {
        return Err("Enter at least 2 characters to find title matches.".to_string());
    }

    let client = source_search_client()?;
    let slug = catalog_slug(&query);
    let first_character = slug
        .chars()
        .next()
        .ok_or_else(|| "Enter at least 2 characters to find title matches.".to_string())?;
    let url = format!("https://v3.sg.media-imdb.com/suggestion/{first_character}/{slug}.json");
    let response = client.get(&url).send().await.map_err(|error| {
        let message = format!("title lookup failed: {error}");
        log_catalog_diagnostic(&format!("request error for {url}: {error:?}"));
        message
    })?;
    let status = response.status();

    if !status.is_success() {
        log_catalog_diagnostic(&format!("non-success status {status} for {url}"));
        return Err(format!("title lookup returned HTTP {status}."));
    }

    let payload = response
        .json::<ImdbSuggestionResponse>()
        .await
        .map_err(|error| {
            let message = format!("title lookup response could not be parsed: {error}");
            log_catalog_diagnostic(&format!("parse error for {url}: {error:?}"));
            message
        })?;

    Ok(payload
        .d
        .unwrap_or_default()
        .into_iter()
        .filter_map(movie_candidate_from_imdb_item)
        .take(8)
        .collect())
}

fn source_search_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(18))
        .redirect(reqwest::redirect::Policy::limited(4))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("failed to create source search client: {error}"))
}

async fn search_1337x(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<ProviderResult>, String> {
    let bases = ["https://1337x.to", "https://www.1377x.to"];
    let mut searches = bases
        .into_iter()
        .map(|base| async move {
            let results = search_1337x_base(client, base, query).await?;

            if results.is_empty() {
                Err(format!("{base} returned no usable results."))
            } else {
                Ok(results)
            }
        })
        .collect::<FuturesUnordered<_>>();
    let mut last_error = "1337x did not return usable results.".to_string();

    while let Some(result) = searches.next().await {
        match result {
            Ok(results) => return Ok(results),
            Err(message) => {
                last_error = message;
            }
        }
    }

    Err(last_error)
}

async fn search_1337x_base(
    client: &reqwest::Client,
    base: &str,
    query: &str,
) -> Result<Vec<ProviderResult>, String> {
    let encoded_query = form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
    let search_url = format!("{base}/sort-search/{encoded_query}/seeders/desc/1/");
    let body = fetch_text(client, &search_url).await?;
    let rows = {
        let document = Html::parse_document(&body);
        let row_selector = selector("tbody tr")?;
        let link_selector = selector("td.coll-1.name a")?;
        let seed_selector = selector("td.coll-2.seeds")?;
        let leech_selector = selector("td.coll-3.leeches")?;
        let size_selector = selector("td.coll-4.size")?;

        let mut rows = Vec::new();

        for (rank, row) in document
            .select(&row_selector)
            .take(SEARCH_LIMIT_PER_PROVIDER)
            .enumerate()
        {
            let torrent_link = row.select(&link_selector).find_map(|anchor| {
                let href = anchor.value().attr("href")?;

                if href.starts_with("/torrent/") {
                    Some((
                        href.to_string(),
                        normalized_text(&anchor.text().collect::<Vec<_>>().join(" ")),
                    ))
                } else {
                    None
                }
            });

            let Some((href, title)) = torrent_link else {
                continue;
            };

            if title.is_empty() {
                continue;
            }

            let category = row.select(&link_selector).find_map(|anchor| {
                let href = anchor.value().attr("href")?;

                if href.starts_with("/sub/") {
                    Some(category_from_1337x_path(href))
                } else {
                    None
                }
            });

            if is_adult_result(category.as_deref(), &title) {
                continue;
            }

            let source_url = Url::parse(base)
                .and_then(|base_url| base_url.join(&href))
                .map(|url| url.to_string())
                .map_err(|error| format!("failed to normalize 1337x result URL: {error}"))?;
            let seeders = parse_first_u32(row.select(&seed_selector).next());
            let leechers = parse_first_u32(row.select(&leech_selector).next());
            let size = row.select(&size_selector).next().and_then(|element| {
                parse_size(&normalized_text(
                    &element.text().collect::<Vec<_>>().join(" "),
                ))
            });

            rows.push(Parsed1337xRow {
                rank,
                source_url,
                title,
                category,
                seeders,
                leechers,
                size,
            });
        }

        rows
    };

    let mut magnet_fetches = rows
        .into_iter()
        .map(|row| async move {
            let Parsed1337xRow {
                rank,
                source_url,
                title,
                category,
                seeders,
                leechers,
                size,
            } = row;
            let magnet_uri = fetch_1337x_magnet(client, &source_url).await.ok();
            let info_hash_v1 = magnet_uri.as_deref().and_then(extract_btih);

            (
                rank,
                ProviderResult {
                    id: format!(
                        "1337x-{}",
                        id_from_url(&source_url).unwrap_or_else(|| slugify(&title))
                    ),
                    provider_id: "1337x".to_string(),
                    provider_name: "1337x".to_string(),
                    title,
                    source_url,
                    magnet_uri,
                    torrent_url: None,
                    info_hash_v1,
                    info_hash_v2: None,
                    size,
                    seeders,
                    leechers,
                    category,
                    license_hint: None,
                },
            )
        })
        .collect::<FuturesUnordered<_>>();
    let mut ranked_results = Vec::new();

    while let Some(result) = magnet_fetches.next().await {
        ranked_results.push(result);
    }

    ranked_results.sort_by_key(|(rank, _)| *rank);

    Ok(ranked_results
        .into_iter()
        .map(|(_, result)| result)
        .collect())
}

async fn fetch_1337x_magnet(client: &reqwest::Client, source_url: &str) -> Result<String, String> {
    let body = fetch_text(client, source_url).await?;
    let document = Html::parse_document(&body);
    let magnet_selector = selector("a[href^=\"magnet:\"]")?;

    if let Some(anchor) = document.select(&magnet_selector).next() {
        if let Some(href) = anchor.value().attr("href") {
            return Ok(href.to_string());
        }
    }

    extract_magnet_from_text(&body)
        .ok_or_else(|| "result page did not include a magnet link".to_string())
}

async fn search_the_pirate_bay(
    client: &reqwest::Client,
    query: &str,
) -> Result<Vec<ProviderResult>, String> {
    let encoded_query = form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>();
    let url = format!("https://apibay.org/q.php?q={encoded_query}&cat=0");
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| format!("The Pirate Bay search failed: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("The Pirate Bay returned HTTP {status}."));
    }

    let api_results = response
        .json::<Vec<TpbApiResult>>()
        .await
        .map_err(|error| format!("The Pirate Bay response could not be parsed: {error}"))?;

    let results = api_results
        .into_iter()
        .filter(|result| result.id != "0")
        .filter(|result| !result.info_hash.trim().is_empty())
        .filter(|result| !result.category.starts_with('5'))
        .take(SEARCH_LIMIT_PER_PROVIDER)
        .map(|result| {
            let info_hash = result.info_hash.trim().to_ascii_uppercase();
            let source_url = format!("https://thepiratebay.org/description.php?id={}", result.id);
            let title = normalized_text(&result.name);
            let category = tpb_category_label(&result.category);

            ProviderResult {
                id: format!("the-pirate-bay-{}", result.id),
                provider_id: "the-pirate-bay".to_string(),
                provider_name: "The Pirate Bay".to_string(),
                title: title.clone(),
                source_url,
                magnet_uri: Some(build_magnet(&info_hash, &title)),
                torrent_url: None,
                info_hash_v1: Some(info_hash),
                info_hash_v2: None,
                size: result.size.parse::<u64>().ok(),
                seeders: result.seeders.parse::<u32>().ok(),
                leechers: result.leechers.parse::<u32>().ok(),
                category,
                license_hint: None,
            }
        })
        .collect();

    Ok(results)
}

async fn fetch_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("{url} failed: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("{url} returned HTTP {status}."));
    }

    response
        .text()
        .await
        .map_err(|error| format!("{url} response could not be read: {error}"))
}

fn selector(pattern: &str) -> Result<Selector, String> {
    Selector::parse(pattern).map_err(|_| format!("invalid selector: {pattern}"))
}

fn provider_error(provider_id: &str, provider_name: &str, message: String) -> ProviderSearchError {
    ProviderSearchError {
        provider_id: provider_id.to_string(),
        provider_name: provider_name.to_string(),
        message,
    }
}

fn normalized_text(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn log_catalog_diagnostic(message: &str) {
    eprintln!("[catalog] {message}");

    if let Ok(mut path) = std::env::temp_dir().canonicalize() {
        path.push("torrentdock-catalog.log");
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            use std::io::Write;
            let _ = writeln!(file, "{message}");
        }
    }
}

fn movie_candidate_from_imdb_item(item: ImdbSuggestionItem) -> Option<MovieTitleCandidate> {
    let id = item.id?;
    let title = item.l?;
    let kind_key = item.qid.or(item.q).unwrap_or_default();

    if !id.starts_with("tt") || !is_catalog_kind(&kind_key) {
        return None;
    }

    let search_title = sanitize_media_search_title(&if let Some(year) = item.y {
        format!("{title} {year}")
    } else {
        title.clone()
    });

    Some(MovieTitleCandidate {
        id,
        title,
        year: item.y,
        kind: catalog_kind_label(&kind_key).to_string(),
        credits: item.s.filter(|value| !value.trim().is_empty()),
        image_url: item.i.and_then(|image| image.image_url),
        search_title,
    })
}

fn is_catalog_kind(value: &str) -> bool {
    matches!(
        value,
        "feature" | "movie" | "tvSeries" | "tvMiniSeries" | "tvMovie" | "video"
    )
}

fn catalog_kind_label(value: &str) -> &str {
    match value {
        "feature" | "movie" => "movie",
        "tvSeries" => "series",
        "tvMiniSeries" => "mini series",
        "tvMovie" => "tv movie",
        "video" => "video",
        _ => "title",
    }
}

fn catalog_slug(value: &str) -> String {
    let mut slug = value
        .chars()
        .filter_map(|character| {
            if character.is_ascii_alphanumeric() {
                Some(character.to_ascii_lowercase())
            } else if character.is_whitespace() || matches!(character, ':' | '\'' | '-') {
                Some('_')
            } else {
                None
            }
        })
        .collect::<String>();

    while slug.contains("__") {
        slug = slug.replace("__", "_");
    }

    slug.trim_matches('_').chars().take(80).collect()
}

fn sanitize_media_search_title(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || character.is_whitespace() {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_first_u32(element: Option<scraper::ElementRef<'_>>) -> Option<u32> {
    element
        .map(|element| normalized_text(&element.text().collect::<Vec<_>>().join(" ")))
        .and_then(|text| text.replace(',', "").parse::<u32>().ok())
}

fn parse_size(value: &str) -> Option<u64> {
    let mut parts = value.split_whitespace();
    let number = parts.next()?.replace(',', "");
    let unit = parts.next()?.to_ascii_lowercase();
    let amount = number.parse::<f64>().ok()?;
    let multiplier = match unit.as_str() {
        "b" | "byte" | "bytes" => 1_f64,
        "kb" | "kib" => 1024_f64,
        "mb" | "mib" => 1024_f64.powi(2),
        "gb" | "gib" => 1024_f64.powi(3),
        "tb" | "tib" => 1024_f64.powi(4),
        _ => return None,
    };

    Some((amount * multiplier).round() as u64)
}

fn category_from_1337x_path(path: &str) -> String {
    path.trim_matches('/')
        .split('/')
        .skip(1)
        .take(2)
        .filter(|segment| !segment.is_empty())
        .map(|segment| segment.replace('-', " "))
        .collect::<Vec<_>>()
        .join(" / ")
}

fn tpb_category_label(category: &str) -> Option<String> {
    let label = match category {
        "101" => "audio / music",
        "102" => "audio / audiobook",
        "103" => "audio / sound clip",
        "104" => "audio / flac",
        "199" => "audio / other",
        "201" => "video / movie",
        "202" => "video / movie dvdr",
        "203" => "video / music video",
        "204" => "video / clip",
        "205" => "video / tv",
        "206" => "video / handheld",
        "207" => "video / hd movie",
        "208" => "video / hd tv",
        "209" => "video / 3d",
        "299" => "video / other",
        "301" => "apps / windows",
        "302" => "apps / mac",
        "303" => "apps / unix",
        "304" => "apps / handheld",
        "305" => "apps / ios",
        "306" => "apps / android",
        "399" => "apps / other",
        "401" => "games / pc",
        "402" => "games / mac",
        "403" => "games / psx",
        "404" => "games / xbox",
        "405" => "games / wii",
        "406" => "games / handheld",
        "407" => "games / ios",
        "408" => "games / android",
        "499" => "games / other",
        "601" => "other / ebooks",
        "602" => "other / comics",
        "603" => "other / pictures",
        "604" => "other / covers",
        "605" => "other / physibles",
        "699" => "other",
        _ => return None,
    };

    Some(label.to_string())
}

fn build_magnet(info_hash: &str, title: &str) -> String {
    let mut magnet = format!(
        "magnet:?xt=urn:btih:{}&dn={}",
        encode_query_component(info_hash),
        encode_query_component(title)
    );

    for tracker in DEFAULT_TRACKERS {
        magnet.push_str("&tr=");
        magnet.push_str(&encode_query_component(tracker));
    }

    magnet
}

fn encode_query_component(value: &str) -> String {
    form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>()
}

fn extract_btih(magnet: &str) -> Option<String> {
    let query = magnet.strip_prefix("magnet:?")?;

    form_urlencoded::parse(query.as_bytes()).find_map(|(key, value)| {
        if key == "xt" {
            value
                .strip_prefix("urn:btih:")
                .map(|hash| hash.to_ascii_uppercase())
        } else {
            None
        }
    })
}

fn extract_magnet_from_text(value: &str) -> Option<String> {
    let start = value.find("magnet:?")?;
    let rest = &value[start..];
    let end = rest
        .find(|character| matches!(character, '"' | '\'' | '<' | ' ' | '\n' | '\r' | '\t'))
        .unwrap_or(rest.len());

    Some(rest[..end].replace("&amp;", "&"))
}

fn id_from_url(source_url: &str) -> Option<String> {
    Url::parse(source_url)
        .ok()?
        .path_segments()?
        .collect::<Vec<_>>()
        .windows(2)
        .find_map(|window| {
            if window[0] == "torrent" {
                Some(window[1].to_string())
            } else {
                None
            }
        })
}

fn slugify(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>();

    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }

    slug.trim_matches('-').chars().take(56).collect()
}

fn dedupe_results(results: Vec<ProviderResult>) -> Vec<ProviderResult> {
    let mut seen = Vec::<String>::new();
    let mut deduped = Vec::new();

    for result in results {
        let key = result
            .info_hash_v1
            .clone()
            .or_else(|| result.magnet_uri.clone())
            .unwrap_or_else(|| format!("{}:{}", result.provider_id, result.source_url));

        if seen.iter().any(|seen_key| seen_key == &key) {
            continue;
        }

        seen.push(key);
        deduped.push(result);
    }

    deduped
}

fn is_adult_result(category: Option<&str>, title: &str) -> bool {
    let category = category.unwrap_or_default().to_ascii_lowercase();
    let title = title.to_ascii_lowercase();

    category.contains("xxx")
        || category.contains("adult")
        || title.contains(" xxx")
        || title.starts_with("xxx ")
        || title.ends_with(" xxx")
}
