import {EDITOR, USER} from '../core/manager.js';
// @ts-ignore
let ChatCompletionService = undefined;
try {
    // 动态导入，兼容模块不存在的情况
    const module = await import('/scripts/custom-request.js');
    ChatCompletionService = module.ChatCompletionService;
} catch (e) {
    console.warn("未检测到 /scripts/custom-request.js 或未正确导出 ChatCompletionService，将禁用代理相关功能。", e);
}
export class LLMApiService {
    constructor(config = {}) {
        this.config = {
            api_url: config.api_url || "https://api.openai.com/v1",
            api_key: config.api_key || "",
            model_name: config.model_name || "gpt-3.5-turbo",
            system_prompt: config.system_prompt || "You are a helpful assistant.",
            temperature: config.temperature || 1.0,
            max_tokens: config.max_tokens || 63000,
            stream: config.stream || false
        };
    }

    async callLLM(prompt, streamCallback = null) {
        if (!prompt) throw new Error("输入内容不能为空");
        if (!this.config.api_url || !this.config.api_key || !this.config.model_name) throw new Error("API配置不完整");

        let messages;
        if (Array.isArray(prompt)) {
            messages = prompt;
        } else if (typeof prompt === 'string') {
            if (prompt.trim().length < 2) throw new Error("输入文本太短");
            messages = [
                { role: 'system', content: this.config.system_prompt },
                { role: 'user', content: prompt }
            ];
        } else {
            throw new Error("无效的输入类型，只接受字符串或消息数组");
        }

        this.config.stream = streamCallback !== null;

        // 如果配置了代理地址，则使用 SillyTavern 的内部路由。
        // chat_completion_source/custom_url/reverse_proxy 这里只是传输字段，绝不参与 Memo-N 的记录接口识别。
        if (USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address) {
            console.log("检测到代理配置，将使用 SillyTavern 内部路由");
            if (typeof ChatCompletionService === 'undefined' || !ChatCompletionService?.processRequest) {
                const errorMessage = "当前酒馆版本过低，无法发送自定义请求。请更新你的酒馆版本";
                EDITOR.error(errorMessage);
                throw new Error(errorMessage);
            }
            try {
                const requestData = {
                    stream: this.config.stream,
                    messages: messages,
                    max_tokens: this.config.max_tokens,
                    model: this.config.model_name,
                    temperature: this.config.temperature,
                    chat_completion_source: 'openai',
                    custom_url: this.config.api_url,
                    reverse_proxy: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address,
                    proxy_password: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key || null,
                };

                if (this.config.stream) {
                    if (!streamCallback || typeof streamCallback !== 'function') throw new Error("流式模式下必须提供有效的streamCallback函数");
                    const streamGenerator = await ChatCompletionService.processRequest(requestData, {}, false);
                    let fullResponse = '';
                    for await (const chunk of streamGenerator()) {
                        if (chunk.text) {
                            fullResponse += chunk.text;
                            streamCallback(chunk.text);
                        }
                    }
                    return this.#cleanResponse(fullResponse);
                }

                const responseData = await ChatCompletionService.processRequest(requestData, {}, true);
                // SillyTavern custom-request 非流式提取结果同时提供 content / reasoning。
                // 某些中转模型会把唯一机器块放在 reasoning；content 为空时允许同一次响应回退读取 reasoning，不发第二次请求。
                const responseText = responseData?.content || responseData?.reasoning || '';
                if (!responseText) throw new Error("通过内部路由获取响应失败，content与reasoning均为空");
                return this.#cleanResponse(responseText);
            } catch (error) {
                console.error("通过 SillyTavern 内部路由调用 LLM API 错误:", error);
                throw error;
            }
        }

        console.log("未检测到代理配置，将使用直接 fetch");
        let apiEndpoint = this.config.api_url;
        if (!apiEndpoint.endsWith("/chat/completions")) apiEndpoint += "/chat/completions";

        const headers = {
            'Authorization': `Bearer ${this.config.api_key}`,
            'Content-Type': 'application/json'
        };
        const data = {
            model: this.config.model_name,
            messages: messages,
            temperature: this.config.temperature,
            max_tokens: this.config.max_tokens,
            stream: this.config.stream
        };

        try {
            if (this.config.stream) {
                if (!streamCallback || typeof streamCallback !== 'function') throw new Error("流式模式下必须提供有效的streamCallback函数");
                return await this.#handleStreamResponse(apiEndpoint, headers, data, streamCallback);
            }
            return await this.#handleRegularResponse(apiEndpoint, headers, data);
        } catch (error) {
            console.error("直接调用 LLM API 错误:", error);
            throw error;
        }
    }

    async #handleRegularResponse(apiEndpoint, headers, data) {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API请求失败: ${response.status} - ${errorText}`);
        }

        const responseData = await response.json();
        const message = responseData?.choices?.[0]?.message;
        // OpenAI兼容中转常见 reasoning_content；只在同一次响应的 content 为空时读取，不构成重试或Provider推断。
        const responseText = message?.content || message?.reasoning_content || message?.reasoning || '';
        if (!responseText) throw new Error("API返回无效的响应结构：content与reasoning均为空");
        return this.#cleanResponse(responseText);
    }

    async #handleStreamResponse(apiEndpoint, headers, data, streamCallback) {
        const response = await fetch(apiEndpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API请求失败: ${response.status} - ${errorText}`);
        }
        if (!response.body) throw new Error("无法获取响应流");

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullResponse = '';
        let chunkIndex = 0;

        try {
            console.log('[Stream] Starting stream processing for custom API...');
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    console.log('[Stream] Custom API stream finished (done=true).');
                    break;
                }

                const decodedChunk = decoder.decode(value, { stream: true });
                buffer += decodedChunk;
                chunkIndex++;
                console.log(`[Stream] Custom API received chunk ${chunkIndex}. Buffer length: ${buffer.length}`);

                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (trimmedLine === '') continue;
                    console.log(`[Stream] Custom API processing line: "${trimmedLine}"`);
                    try {
                        if (!trimmedLine.startsWith('data: ')) {
                            console.log('[Stream] Custom API line does not start with "data: ". Skipping.');
                            continue;
                        }
                        const dataStr = trimmedLine.substring(6).trim();
                        if (dataStr === '[DONE]') {
                            console.log('[Stream] Custom API received [DONE] marker.');
                            continue;
                        }
                        const jsonData = JSON.parse(dataStr);
                        if (jsonData.choices?.[0]?.delta?.content) {
                            const content = jsonData.choices[0].delta.content;
                            fullResponse += content;
                            streamCallback(content);
                        }
                    } catch (e) {
                        console.warn("[Stream] Custom API error parsing line JSON:", e, "Line:", trimmedLine);
                    }
                }
            }

            const finalBufferTrimmed = buffer.trim();
            if (finalBufferTrimmed) {
                console.log(`[Stream] Custom API processing final buffer content: "${finalBufferTrimmed}"`);
                try {
                    if (finalBufferTrimmed.startsWith('data: ')) {
                        const dataStr = finalBufferTrimmed.substring(6).trim();
                        if (dataStr !== '[DONE]') {
                            const jsonData = JSON.parse(dataStr);
                            if (jsonData.choices?.[0]?.delta?.content) {
                                const content = jsonData.choices[0].delta.content;
                                fullResponse += content;
                                streamCallback(content);
                            }
                        }
                    } else {
                        console.warn("[Stream] Custom API final buffer content does not start with 'data: '. Ignoring.");
                    }
                } catch (e) {
                    console.warn("[Stream] Custom API error processing final buffer content:", e);
                }
            }

            console.log('[Stream] Custom API stream processing complete. Full response length:', fullResponse.length);
            return this.#cleanResponse(fullResponse);
        } catch (streamError) {
            console.error('[Stream] Custom API error during stream reading:', streamError);
            throw streamError;
        } finally {
            console.log('[Stream] Custom API releasing stream lock.');
            reader.releaseLock();
        }
    }

    #cleanResponse(text) {
        return String(text ?? '').trim();
    }

    async testConnection() {
        const testPrompt = "Say hello.";
        const messages = [
            { role: 'system', content: this.config.system_prompt },
            { role: 'user', content: testPrompt }
        ];

        if (USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address) {
            console.log("检测到代理配置，将使用 SillyTavern 内部路由进行连接测试");
            try {
                const requestData = {
                    stream: false,
                    messages: messages,
                    max_tokens: 50,
                    model: this.config.model_name,
                    temperature: this.config.temperature,
                    chat_completion_source: 'openai',
                    custom_url: this.config.api_url,
                    reverse_proxy: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address,
                    proxy_password: USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key || null,
                };
                const responseData = await ChatCompletionService.processRequest(requestData, {}, true);
                const responseText = responseData?.content || responseData?.reasoning || '';
                if (!responseText) throw new Error("通过内部路由测试连接失败或响应内容为空");
                return responseText;
            } catch (error) {
                console.error("通过 SillyTavern 内部路由测试 API 连接错误:", error);
                throw error;
            }
        }

        console.log("未检测到代理配置，将使用直接 fetch 进行连接测试");
        let apiEndpoint = this.config.api_url;
        if (!apiEndpoint.endsWith("/chat/completions")) apiEndpoint += "/chat/completions";
        const headers = {
            'Authorization': `Bearer ${this.config.api_key}`,
            'Content-Type': 'application/json'
        };
        const data = {
            model: this.config.model_name,
            messages: messages,
            temperature: this.config.temperature,
            max_tokens: 50,
            stream: false
        };

        try {
            const response = await fetch(apiEndpoint, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(data)
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API测试请求失败: ${response.status} - ${errorText}`);
            }
            const responseData = await response.json();
            const message = responseData?.choices?.[0]?.message;
            const responseText = message?.content || message?.reasoning_content || message?.reasoning || '';
            if (!responseText) throw new Error("API测试返回无效的响应结构");
            return responseText;
        } catch (error) {
            console.error("直接 fetch 测试 API 连接错误:", error);
            throw error;
        }
    }
}

export default LLMApiService;