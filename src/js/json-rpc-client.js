/**
 * JSON-RPC Client Exception class
 * 
 * @param String code
 * @param String message
 */
var JSONRpcClientException = function (code, message) {
    this.code = code;
    this.message = message;
}
JSONRpcClientException.prototype = jQuery.extend(JSONRpcClientException.prototype, {

	/**
	 * Magic method. COnvert object to string.
	 * 
	 * @return String
	 */
    toString: function () {
        return '[' + this.code + '] ' + this.message;
    }
    
});

/**
 * JSON-RPC Client
 * 
 * @param Object options
 */
var JSONRpcClient = function (options) {
    this.setOptions(options);
    this.init();
}
JSONRpcClient.prototype = jQuery.extend(JSONRpcClient.prototype, {

	/**
	 * Default options
	 */
    options: {
        'onerror': function () {},
        'onsuccess': function () {},
        'url': '',
        'headers': {}
    },
    current: 1,
    onerror: null,
    onsuccess: null,
    onstart: null,
	
    /**
     * Init client
     */
    init: function () {
        this.onerror = this.getParam('onerror');
        this.onsuccess = this.getParam('onsuccess');
        
        this.initMethods();
    },

    /**
     * Init API methiods by url
     */
    initMethods: function () {
        var instance = this;
        // get all methods
    	jQuery.ajax(this.getParam('url'), {
            'async': false,
            'success': function (data) {
                if (data.methods) {
                	// create method
                	jQuery.each(data.methods, function(methodName, methodParams) {
                	    var method = function () {
                	    	var params = new Array();
                            for(var i = 0; i < arguments.length; i++){
                                params.push(arguments[i]);
                            }
                            var id = (instance.current++);
                            var callback = params[params.length - 1];
                            var request = {jsonrpc: '2.0', method: methodName, params: params, id: id};
                            
                            var async = false;
                            if (jQuery.type(callback) == 'function') {
                            	async = true;
                            	params.pop();
                            }
                            
                            var res = null;
                            // API request
                            jQuery.ajax(instance.getParam('url'), {
                                'contentType': 'application/json',
                                'type': methodParams.transport,
                                'processData': false,
                                'dataType': 'json',
                                'cache': false,
                                'data': JSON.stringify(request),
                                'headers': instance.getParam('headers'),
                                'async': async,
                                'success': function (result) {
                                    if (jQuery.type(result.error) == 'object') {
                                        res = new JSONRpcClientException(result.error.code, result.error.message);
                                        instance.onerror(res);
                                    } else {
                                        res = result.result;
                                        if (jQuery.type(callback) == 'function') {
                                    	    callback(res);
                                        }
                                    }
                                    instance.onsuccess(res, id, methodName);
                                }
                	        });
                            if (!async) {
                            	return res;
                            }
                	    }

                	    instance[methodName] = method;
                	});
                } else {
                    throw Exception("Methods could not be found");
                }
            }
        });
    },
	
    /**
     * Set client options
     * 
     * @param Object options
     */
    setOptions: function (options) {
        this.options = jQuery.extend({}, this.options, options);
    },

    /**
     * Get client param, if param is not available in this.options return defaultValue
     * 
     * @param String key
     * @param mixed defaultValue
     * @return mixed
     */
    getParam: function (key, defaultValue) {
        if (jQuery.type(this.options[key]) != 'undefined') {
            return this.options[key];
        }
        return defaultValue;
    }
    
});