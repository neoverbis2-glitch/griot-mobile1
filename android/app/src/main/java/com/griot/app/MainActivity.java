package com.griot.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.griot.app.plugin.GriotPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GriotPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
