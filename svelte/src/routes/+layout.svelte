<script lang="ts">
  import {onMount} from 'svelte';

  import '../app.css';
  import {installStaleRecovery, purgeStaleAssets} from '$lib/telegram/staleGuard';

  let {children} = $props();

  // Runs before anything touches MTProto: a browser pinned to a previous build
  // has to be freed first, or every later step fails in confusing ways.
  onMount(() => {
    installStaleRecovery();
    purgeStaleAssets();
  });
</script>

{@render children()}
